import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Unit } from 'aws-embedded-metrics';
import { DEFAULT_FEATURE_FLAG_ENV, FeatureFlagLogEvent } from './constants';
import { FeatureFlagCache } from './feature-flag.cache';
import { evaluateFeatureFlag } from './feature-flag.evaluator';
import { emitFeatureFlagMetrics } from './feature-flag.metrics';
import { FeatureFlagReconciler } from './feature-flag.reconciler';
import { FeatureFlagRepository } from './feature-flag.repository';
import { FeatureFlagSubscriber } from './feature-flag.subscriber';
import {
  IFeatureFlag,
  IFeatureFlagContext,
  IFeatureFlagEvaluationOptions,
  IFeatureFlagHealthStatus,
} from './types';

@Injectable()
export class FeatureFlagService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly cache = new FeatureFlagCache();
  private environment: string = DEFAULT_FEATURE_FLAG_ENV;
  private redisAvailable = false;
  private lastReconciledAt: Date | null = null;
  private lastError: string | null = null;
  private startedAt = new Date();

  constructor(
    private readonly configService: ConfigService,
    private readonly repository: FeatureFlagRepository,
    private readonly subscriber: FeatureFlagSubscriber,
    private readonly reconciler: FeatureFlagReconciler,
  ) {}

  async onModuleInit(): Promise<void> {
    this.environment = this.resolveEnvironment();
    this.startedAt = new Date();
    await this.bootstrap();
  }

  async onModuleDestroy(): Promise<void> {
    this.reconciler.stop();
    await this.subscriber.stop();
  }

  /**
   * Synchronous local evaluation. Never calls Redis on the request path.
   */
  isEnabled(
    key: string,
    context: IFeatureFlagContext = {},
    options: IFeatureFlagEvaluationOptions = {},
  ): boolean {
    const flag = this.cache.get(key);
    const result = evaluateFeatureFlag(flag, context, options);
    void emitFeatureFlagMetrics({
      enabled: this.metricsEnabled(),
      name: 'feature_flag_evaluation_total',
      dimensions: { Result: result.enabled ? 'on' : 'off' },
    });
    if (result.usedDefault) {
      this.logger.warn(
        `${FeatureFlagLogEvent.EVALUATION_DEFAULT_USED} key=${key} reason=${result.reason}`,
      );
      if (result.reason === 'invalid_percentage') {
        void emitFeatureFlagMetrics({
          enabled: this.metricsEnabled(),
          name: 'feature_flag_evaluation_errors',
        });
      }
    }
    return result.enabled;
  }

  getFlag(key: string): IFeatureFlag | undefined {
    return this.cache.get(key);
  }

  listLocalFlags(): IFeatureFlag[] {
    return Array.from(this.cache.getSnapshot().values());
  }

  getEnvironment(): string {
    return this.environment;
  }

  getCache(): FeatureFlagCache {
    return this.cache;
  }

  getHealthStatus(): IFeatureFlagHealthStatus {
    const staleAgeMs = this.lastReconciledAt
      ? Date.now() - this.lastReconciledAt.getTime()
      : Date.now() - this.startedAt.getTime();
    const stale =
      !this.redisAvailable ||
      !this.subscriber.isConnected() ||
      this.lastError != null;
    void emitFeatureFlagMetrics({
      enabled: this.metricsEnabled(),
      name: 'feature_flag_stale_age',
      value: staleAgeMs,
      unit: Unit.Milliseconds,
    });
    return {
      healthy: this.redisAvailable && this.subscriber.isConnected(),
      stale,
      redisAvailable: this.redisAvailable,
      pubSubConnected: this.subscriber.isConnected(),
      flagCount: this.cache.size(),
      lastReconciledAt: this.lastReconciledAt
        ? this.lastReconciledAt.toISOString()
        : null,
      lastError: this.lastError,
    };
  }

  async reconcileNow(): Promise<void> {
    const result = await this.reconciler.reconcile();
    this.applyReconcileResult(result.success, result.error);
  }

  private async bootstrap(): Promise<void> {
    try {
      const reachable = await this.repository.ping();
      if (!reachable) {
        throw new Error('Redis ping failed');
      }
      const flags = await this.repository.loadAllFlags(this.environment);
      this.cache.replaceAll(flags);
      this.redisAvailable = true;
      this.lastReconciledAt = new Date();
      this.lastError = null;
      this.logger.log(
        `Feature flags loaded: count=${this.cache.size()} env=${this.environment}`,
      );
    } catch (error) {
      this.redisAvailable = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `${FeatureFlagLogEvent.REDIS_UNAVAILABLE}: starting with empty snapshot: ${this.lastError}`,
      );
      void emitFeatureFlagMetrics({
        enabled: this.metricsEnabled(),
        name: 'feature_flag_redis_errors',
      });
      this.cache.replaceAll([]);
    }

    this.reconciler.start({
      environment: this.environment,
      cache: this.cache,
      onResult: (result) => {
        this.applyReconcileResult(result.success, result.error);
      },
    });

    await this.subscriber.start({
      environment: this.environment,
      cache: this.cache,
      onReconnect: async () => {
        await this.reconcileNow();
      },
    });
  }

  private applyReconcileResult(success: boolean, error: string | null): void {
    if (success) {
      this.redisAvailable = true;
      this.lastReconciledAt = new Date();
      this.lastError = null;
      return;
    }
    this.redisAvailable = false;
    this.lastError = error;
  }

  private resolveEnvironment(): string {
    return (
      this.configService.get<string>('FEATURE_FLAG_ENV') ||
      this.configService.get<string>('NODE_ENV') ||
      DEFAULT_FEATURE_FLAG_ENV
    );
  }

  private metricsEnabled(): boolean {
    return this.configService.get<string>('FEATURE_FLAG_METRICS') !== 'false';
  }
}
