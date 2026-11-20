import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Unit } from 'aws-embedded-metrics';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagAuditService } from './feature-flag.audit.service';
import { emitFeatureFlagMetrics } from './feature-flag.metrics';
import { FeatureFlagRepository } from './feature-flag.repository';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlagAuditAction } from './schemas';
import {
  CreateFeatureFlagDto,
  DeleteFeatureFlagDto,
  UpdateFeatureFlagDto,
} from './dto';
import { FeatureFlagType, IFeatureFlag } from './types';

export interface IFeatureFlagActor {
  userId: string;
  email: string;
}

@Injectable()
export class FeatureFlagManager {
  private readonly logger = new Logger(FeatureFlagManager.name);

  constructor(
    private readonly repository: FeatureFlagRepository,
    private readonly featureFlagService: FeatureFlagService,
    private readonly auditService: FeatureFlagAuditService,
    private readonly configService: ConfigService,
  ) {}

  async list(
    cursor?: string,
    limit = 50,
  ): Promise<{
    items: IFeatureFlag[];
    nextCursor: string | null;
  }> {
    const environment = this.featureFlagService.getEnvironment();
    const pageLimit = Math.min(Math.max(1, limit), 200);
    const keys = (await this.repository.listFlagKeys(environment)).sort(
      (a, b) => a.localeCompare(b),
    );
    const startIndex = cursor ? Math.max(0, keys.indexOf(cursor) + 1) : 0;
    const pageKeys = keys.slice(startIndex, startIndex + pageLimit);
    const flags: IFeatureFlag[] = [];
    for (const key of pageKeys) {
      const flag = await this.repository.getFlag(environment, key);
      if (flag) {
        flags.push(flag);
      }
    }
    const lastKey = pageKeys.at(-1);
    const hasMore =
      lastKey !== undefined && keys.indexOf(lastKey) < keys.length - 1;
    return {
      items: flags,
      nextCursor: hasMore && lastKey ? lastKey : null,
    };
  }

  async get(key: string): Promise<IFeatureFlag> {
    const environment = this.featureFlagService.getEnvironment();
    const flag = await this.repository.getFlag(environment, key);
    if (!flag) {
      throw new NotFoundException(`Feature flag ${key} not found`);
    }
    this.warnIfExpired(flag);
    return flag;
  }

  async create(
    dto: CreateFeatureFlagDto,
    actor: IFeatureFlagActor,
  ): Promise<IFeatureFlag> {
    this.assertPercentageFields(dto);
    const environment = this.featureFlagService.getEnvironment();
    const now = new Date().toISOString();
    const payload: Omit<IFeatureFlag, 'version'> & { version?: number } = {
      key: dto.key,
      enabled: dto.enabled,
      type: dto.type,
      environment,
      createdAt: now,
      updatedAt: now,
    };
    if (dto.type === FeatureFlagType.PERCENTAGE) {
      if (dto.rolloutPercentage !== undefined) {
        payload.rolloutPercentage = dto.rolloutPercentage;
      }
      if (dto.targeting !== undefined) {
        payload.targeting = {
          attribute: dto.targeting.attribute,
        };
      }
    }
    if (dto.description !== undefined) {
      payload.description = dto.description;
    }
    if (dto.owner !== undefined) {
      payload.owner = dto.owner;
    }
    if (dto.expiresAt !== undefined) {
      payload.expiresAt = dto.expiresAt;
    }

    const started = Date.now();
    const casWriteResponse = await this.repository.casWrite({
      environment,
      key: dto.key,
      operation: 'create',
      expectedVersion: 0,
      flagJson: JSON.stringify(payload),
      event: { environment, key: dto.key },
    });
    void emitFeatureFlagMetrics({
      enabled: this.metricsEnabled(),
      name: 'feature_flag_update_latency',
      value: Date.now() - started,
      unit: Unit.Milliseconds,
    });

    if (casWriteResponse.status === 'conflict') {
      throw new ConflictException(
        `Feature flag ${dto.key} already exists or version conflict`,
      );
    }
    if (!casWriteResponse.flag) {
      throw new ConflictException(`Failed to create feature flag ${dto.key}`);
    }

    await this.auditService.record({
      key: dto.key,
      environment,
      action: FeatureFlagAuditAction.CREATE,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      oldValue: null,
      newValue: casWriteResponse.flag as unknown as Record<string, unknown>,
      version: casWriteResponse.version,
    });

    this.featureFlagService.getCache().applyUpdate(casWriteResponse.flag);
    return casWriteResponse.flag;
  }

  async update(
    key: string,
    dto: UpdateFeatureFlagDto,
    actor: IFeatureFlagActor,
  ): Promise<IFeatureFlag> {
    this.assertPercentageFields(dto);
    const environment = this.featureFlagService.getEnvironment();
    const existing = await this.repository.getFlag(environment, key);
    if (!existing) {
      throw new NotFoundException(`Feature flag ${key} not found`);
    }
    this.warnIfExpired(existing);

    const now = new Date().toISOString();
    const payload: IFeatureFlag = {
      key,
      enabled: dto.enabled,
      type: dto.type,
      environment,
      createdAt: existing.createdAt,
      updatedAt: now,
      version: existing.version,
    };
    if (dto.type === FeatureFlagType.PERCENTAGE) {
      if (dto.rolloutPercentage !== undefined) {
        payload.rolloutPercentage = dto.rolloutPercentage;
      }
      if (dto.targeting !== undefined) {
        payload.targeting = {
          attribute: dto.targeting.attribute,
        };
      }
    }
    if (dto.description !== undefined) {
      payload.description = dto.description;
    }
    if (dto.owner !== undefined) {
      payload.owner = dto.owner;
    }
    if (dto.expiresAt !== undefined) {
      payload.expiresAt = dto.expiresAt;
    }

    const started = Date.now();
    const casWriteResponse = await this.repository.casWrite({
      environment,
      key,
      operation: 'update',
      expectedVersion: dto.expectedVersion,
      flagJson: JSON.stringify(payload),
      event: { environment, key },
    });
    void emitFeatureFlagMetrics({
      enabled: this.metricsEnabled(),
      name: 'feature_flag_update_latency',
      value: Date.now() - started,
      unit: Unit.Milliseconds,
    });

    if (casWriteResponse.status === 'conflict') {
      throw new ConflictException(
        `Feature flag ${key} version conflict (expected ${dto.expectedVersion})`,
      );
    }
    if (casWriteResponse.status === 'not_found' || !casWriteResponse.flag) {
      throw new NotFoundException(`Feature flag ${key} not found`);
    }

    await this.auditService.record({
      key,
      environment,
      action: FeatureFlagAuditAction.UPDATE,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: casWriteResponse.flag as unknown as Record<string, unknown>,
      version: casWriteResponse.version,
    });

    this.featureFlagService.getCache().applyUpdate(casWriteResponse.flag);
    return casWriteResponse.flag;
  }

  async delete(
    key: string,
    dto: DeleteFeatureFlagDto,
    actor: IFeatureFlagActor,
  ): Promise<{ key: string; version: number }> {
    const environment = this.featureFlagService.getEnvironment();
    const existing = await this.repository.getFlag(environment, key);
    if (!existing) {
      throw new NotFoundException(`Feature flag ${key} not found`);
    }

    const started = Date.now();
    const casWriteResponse = await this.repository.casWrite({
      environment,
      key,
      operation: 'delete',
      expectedVersion: dto.expectedVersion,
      event: { environment, key },
    });
    void emitFeatureFlagMetrics({
      enabled: this.metricsEnabled(),
      name: 'feature_flag_update_latency',
      value: Date.now() - started,
      unit: Unit.Milliseconds,
    });

    if (casWriteResponse.status === 'conflict') {
      throw new ConflictException(
        `Feature flag ${key} version conflict (expected ${dto.expectedVersion})`,
      );
    }
    if (casWriteResponse.status === 'not_found') {
      throw new NotFoundException(`Feature flag ${key} not found`);
    }

    await this.auditService.record({
      key,
      environment,
      action: FeatureFlagAuditAction.DELETE,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: null,
      version: casWriteResponse.version,
    });

    this.featureFlagService
      .getCache()
      .applyDelete(key, casWriteResponse.version);
    return { key, version: casWriteResponse.version };
  }

  private assertPercentageFields(
    dto: CreateFeatureFlagDto | UpdateFeatureFlagDto,
  ): void {
    if (dto.type !== FeatureFlagType.PERCENTAGE) {
      return;
    }
    if (
      typeof dto.rolloutPercentage !== 'number' ||
      dto.rolloutPercentage < 0 ||
      dto.rolloutPercentage > 100
    ) {
      throw new BadRequestException(
        'rolloutPercentage must be an integer between 0 and 100',
      );
    }
    if (!dto.targeting?.attribute) {
      throw new BadRequestException(
        'targeting.attribute is required for percentage flags',
      );
    }
  }

  private warnIfExpired(flag: IFeatureFlag): void {
    if (!flag.expiresAt) {
      return;
    }
    const expires = Date.parse(flag.expiresAt);
    if (!Number.isNaN(expires) && expires < Date.now()) {
      this.logger.warn(
        `Feature flag ${flag.key} is past expiresAt=${flag.expiresAt}`,
      );
    }
  }

  private metricsEnabled(): boolean {
    const explicit = this.configService.get<string>('FEATURE_FLAG_METRICS');
    if (explicit === 'true') {
      return true;
    }
    if (explicit === 'false') {
      return false;
    }
    return (
      (this.configService.get<string>('NODE_ENV') ?? 'development') ===
      'production'
    );
  }
}
