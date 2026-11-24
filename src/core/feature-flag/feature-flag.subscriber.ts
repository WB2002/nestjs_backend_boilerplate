import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from '@/common/redis/redis.service';
import { FeatureFlagLogEvent } from './constants';
import { FeatureFlagCache } from './feature-flag.cache';
import { featureFlagEventsChannel } from './feature-flag.keys';
import { emitFeatureFlagMetrics } from './feature-flag.metrics';
import { FeatureFlagRepository } from './feature-flag.repository';
import { FeatureFlagEventType, IFeatureFlagEvent } from './types';

@Injectable()
export class FeatureFlagSubscriber {
  private readonly logger = new Logger(FeatureFlagSubscriber.name);
  private subscriber: Redis | null = null;
  private isPubSubConnected = false;
  private isIntentionalStop = false;
  private isReconnecting = false;
  private environment = '';
  private cache: FeatureFlagCache | null = null;
  private onReconnect: (() => Promise<void>) | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly repository: FeatureFlagRepository,
    private readonly configService: ConfigService,
  ) {}

  isConnected(): boolean {
    return this.isPubSubConnected;
  }

  async start(params: {
    environment: string;
    cache: FeatureFlagCache;
    onReconnect: () => Promise<void>;
  }): Promise<void> {
    this.environment = params.environment;
    this.cache = params.cache;
    this.onReconnect = params.onReconnect;
    this.isIntentionalStop = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.isIntentionalStop = true;
    if (!this.subscriber) {
      return;
    }
    try {
      await this.subscriber.quit();
    } catch {
      this.subscriber.disconnect(false);
    }
    this.subscriber = null;
    this.isPubSubConnected = false;
  }

  private async connect(): Promise<void> {
    try {
      const commandClient = this.redisService.getClient();
      this.subscriber = commandClient.duplicate({
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.subscriber.on('error', (error: Error) => {
        this.logger.warn(
          `${FeatureFlagLogEvent.PUBSUB_DISCONNECTED}: ${error.message}`,
        );
      });
      this.subscriber.on('end', () => {
        void this.handleDisconnect();
      });
      this.subscriber.on('close', () => {
        void this.handleDisconnect();
      });

      await this.subscriber.connect();

      await this.subscriber.subscribe(featureFlagEventsChannel());
      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel !== featureFlagEventsChannel()) {
          return;
        }
        void this.handleMessage(message);
      });
      this.isPubSubConnected = true;
      this.logger.log('Feature flag Pub/Sub subscribed');
    } catch (error) {
      this.isPubSubConnected = false;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `${FeatureFlagLogEvent.PUBSUB_DISCONNECTED}: ${message}`,
      );
      void emitFeatureFlagMetrics({
        enabled: this.metricsEnabled(),
        name: 'feature_flag_pubsub_disconnects',
      });
    }
  }

  private async handleDisconnect(): Promise<void> {
    if (this.isIntentionalStop || this.isReconnecting) {
      return;
    }
    if (!this.isPubSubConnected && !this.subscriber) {
      return;
    }
    this.isReconnecting = true;
    this.isPubSubConnected = false;
    this.logger.warn(FeatureFlagLogEvent.PUBSUB_DISCONNECTED);
    void emitFeatureFlagMetrics({
      enabled: this.metricsEnabled(),
      name: 'feature_flag_pubsub_disconnects',
    });

    try {
      await this.delay(1_000);
      if (this.isIntentionalStop) {
        return;
      }

      if (this.subscriber) {
        try {
          await this.subscriber.quit();
        } catch {
          this.subscriber.disconnect(false);
        }
        this.subscriber = null;
      }
      await this.connect();
      if (this.isPubSubConnected && this.onReconnect) {
        await this.onReconnect();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Pub/Sub reconnect failed: ${message}`);
    } finally {
      this.isReconnecting = false;
    }
  }

  private async handleMessage(message: string): Promise<void> {
    if (!this.cache) {
      return;
    }
    let event: IFeatureFlagEvent;
    try {
      event = JSON.parse(message) as IFeatureFlagEvent;
    } catch {
      this.logger.warn('Ignoring malformed feature flag Pub/Sub message');
      return;
    }

    if (
      event.event !== FeatureFlagEventType.FLAG_UPDATED &&
      event.event !== FeatureFlagEventType.FLAG_DELETED
    ) {
      return;
    }
    if (event.environment !== this.environment) {
      return;
    }

    try {
      if (event.event === FeatureFlagEventType.FLAG_DELETED) {
        const hasChanged = this.cache.applyDelete(event.key, event.version);
        if (hasChanged) {
          this.logger.log(
            `${FeatureFlagLogEvent.DELETED} key=${event.key} version=${event.version}`,
          );
        }
        return;
      }

      const flag = await this.repository.getFlag(this.environment, event.key);
      const hasChanged = this.cache.applyEvent(event, this.environment, flag);
      if (hasChanged) {
        this.logger.log(
          `${FeatureFlagLogEvent.UPDATED} key=${event.key} version=${event.version}`,
        );
        void emitFeatureFlagMetrics({
          enabled: this.metricsEnabled(),
          name: 'feature_flag_update_total',
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to apply feature flag event: ${msg}`);
      void emitFeatureFlagMetrics({
        enabled: this.metricsEnabled(),
        name: 'feature_flag_redis_errors',
      });
    }
  }

  private metricsEnabled(): boolean {
    if (this.configService.get<string>('FEATURE_FLAG_METRICS') === 'false') {
      return false;
    }
    const appMetrics =
      this.configService.get<string>('APP_METRICS_ENABLED') ??
      process.env.APP_METRICS_ENABLED;
    if (appMetrics != null) {
      const normalized = appMetrics.trim().toLowerCase();
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }
    return true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
