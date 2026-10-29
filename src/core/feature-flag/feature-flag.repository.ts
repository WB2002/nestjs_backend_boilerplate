import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from '@/common/redis/redis.service';
import { isValidFeatureFlagShape } from './feature-flag.evaluator';
import {
  featureFlagEventsChannel,
  featureFlagIndexKey,
  featureFlagKey,
} from './feature-flag.keys';
import { IFeatureFlag, IFeatureFlagEvent } from './types';

export type FeatureFlagCasStatus = 'ok' | 'conflict' | 'not_found';

export interface IFeatureFlagCasResult {
  status: FeatureFlagCasStatus;
  version: number;
  flag: IFeatureFlag | null;
  currentJson: string;
}

@Injectable()
export class FeatureFlagRepository {
  private readonly logger = new Logger(FeatureFlagRepository.name);
  private scriptSha: string | null = null;
  private readonly scriptSource: string;

  constructor(private readonly redisService: RedisService) {
    this.scriptSource = readFileSync(
      join(__dirname, 'lua', 'cas_write.lua'),
      'utf8',
    );
  }

  private get redis(): Redis {
    return this.redisService.getClient();
  }

  async ping(): Promise<boolean> {
    try {
      const casResponse = await Promise.race([
        this.redis.ping(),
        new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('Redis ping timeout')), 2_000);
        }),
      ]);
      return casResponse === 'PONG';
    } catch {
      return false;
    }
  }

  async getFlag(
    environment: string,
    key: string,
  ): Promise<IFeatureFlag | null> {
    const raw = await this.redis.get(featureFlagKey(environment, key));
    return this.parseFlag(raw);
  }

  async listFlagKeys(environment: string): Promise<string[]> {
    return this.redis.smembers(featureFlagIndexKey(environment));
  }

  async loadAllFlags(environment: string): Promise<IFeatureFlag[]> {
    const keys = await this.listFlagKeys(environment);
    if (keys.length === 0) {
      return [];
    }
    const redisKeys = keys.map((key) => featureFlagKey(environment, key));
    const values = await this.redis.mget(...redisKeys);
    const flags: IFeatureFlag[] = [];
    for (const raw of values) {
      const flag = this.parseFlag(raw);
      if (flag) {
        flags.push(flag);
      }
    }
    return flags;
  }

  async casWrite(params: {
    environment: string;
    key: string;
    operation: 'create' | 'update' | 'delete';
    expectedVersion: number;
    flagJson?: string;
    event: Omit<IFeatureFlagEvent, 'version' | 'event'> & {
      event?: IFeatureFlagEvent['event'];
    };
  }): Promise<IFeatureFlagCasResult> {
    await this.ensureScriptLoaded();
    const eventPayload = JSON.stringify({
      event: params.event.event ?? 'FLAG_UPDATED',
      environment: params.environment,
      key: params.key,
      version: 0,
    });
    const args = [
      params.operation,
      String(params.expectedVersion),
      eventPayload,
      params.flagJson ?? '',
    ];
    const keys = [
      featureFlagKey(params.environment, params.key),
      featureFlagIndexKey(params.environment),
      featureFlagEventsChannel(),
    ];

    let casResponse: unknown;
    try {
      if (!this.scriptSha) {
        await this.ensureScriptLoaded();
      }
      const sha = this.scriptSha;
      if (!sha) {
        throw new Error('Feature flag CAS script failed to load');
      }
      casResponse = await this.redis.evalsha(
        sha,
        keys.length,
        ...keys,
        ...args,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOSCRIPT')) {
        this.scriptSha = null;
        await this.ensureScriptLoaded();
        const sha = this.scriptSha;
        if (!sha) {
          throw new Error('Feature flag CAS script failed to reload');
        }
        casResponse = await this.redis.evalsha(
          sha,
          keys.length,
          ...keys,
          ...args,
        );
      } else {
        throw error;
      }
    }

    return this.parseCasResult(casResponse);
  }

  private async ensureScriptLoaded(): Promise<void> {
    if (this.scriptSha) {
      return;
    }
    this.scriptSha = (await this.redis.script(
      'LOAD',
      this.scriptSource,
    )) as string;
  }

  private parseFlag(raw: string | null): IFeatureFlag | null {
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isValidFeatureFlagShape(parsed)) {
        this.logger.warn('Skipping malformed feature flag JSON from Redis');
        return null;
      }
      return parsed;
    } catch {
      this.logger.warn('Skipping unparseable feature flag JSON from Redis');
      return null;
    }
  }

  private parseCasResult(casResponse: unknown): IFeatureFlagCasResult {
    if (!Array.isArray(casResponse) || casResponse.length < 3) {
      throw new Error('Unexpected CAS script response');
    }
    const status = String(casResponse[0]) as FeatureFlagCasStatus;
    const version = Number(casResponse[1]);
    const currentJson = String(casResponse[2] ?? '');
    return {
      status,
      version: Number.isFinite(version) ? version : 0,
      flag: this.parseFlag(currentJson || null),
      currentJson,
    };
  }
}
