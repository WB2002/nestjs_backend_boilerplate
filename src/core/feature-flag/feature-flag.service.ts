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
  private isRedisAvailable = false;
  private lastReconciledAt: Date | null = null;
  private lastError: string | null = null;
  private startedAt = new Date();
  private evaluationMetricCounter = 0;

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
    const evaluation = evaluateFeatureFlag(flag, context, options);
    if (this.shouldSampleEvaluationMetrics()) {
      void emitFeatureFlagMetrics({
        enabled: true,
        name: 'feature_flag_evaluation_total',
        dimensions: { Result: evaluation.enabled ? 'on' : 'off' },
      });
    }
    if (evaluation.usedDefault) {
      this.logger.warn(
        `${FeatureFlagLogEvent.EVALUATION_DEFAULT_USED} key=${key} reason=${evaluation.reason}`,
      );
      if (evaluation.reason === 'invalid_percentage') {
        void emitFeatureFlagMetrics({
          enabled: this.metricsEnabled(),
          name: 'feature_flag_evaluation_errors',
        });
      }
    }
    return evaluation.enabled;
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
    const isStale =
      !this.isRedisAvailable ||
      !this.subscriber.isConnected() ||
      this.lastError != null;
    void emitFeatureFlagMetrics({
      enabled: this.metricsEnabled(),
      name: 'feature_flag_stale_age',
      value: staleAgeMs,
      unit: Unit.Milliseconds,
    });
    return {
      healthy: this.isRedisAvailable && this.subscriber.isConnected(),
      stale: isStale,
      redisAvailable: this.isRedisAvailable,
      pubSubConnected: this.subscriber.isConnected(),
      flagCount: this.cache.size(),
      lastReconciledAt: this.lastReconciledAt
        ? this.lastReconciledAt.toISOString()
        : null,
      lastError: this.lastError,
    };
  }

  async reconcileNow(): Promise<void> {
    const reconcileSummary = await this.reconciler.reconcile();
    this.applyReconcileResult(reconcileSummary.success, reconcileSummary.error);
  }

  private async bootstrap(): Promise<void> {
    try {
      const isReachable = await this.repository.ping();
      if (!isReachable) {
        throw new Error('Redis ping failed');
      }
      const flags = await this.repository.loadAllFlags(this.environment);
      this.cache.replaceAll(flags);
      this.isRedisAvailable = true;
      this.lastReconciledAt = new Date();
      this.lastError = null;
      this.logger.log(
        `Feature flags loaded: count=${this.cache.size()} env=${this.environment}`,
      );
    } catch (error) {
      this.isRedisAvailable = false;
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
      onResult: (reconcileSummary) => {
        this.applyReconcileResult(
          reconcileSummary.success,
          reconcileSummary.error,
        );
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

  private applyReconcileResult(
    isSuccessful: boolean,
    error: string | null,
  ): void {
    if (isSuccessful) {
      this.isRedisAvailable = true;
      this.lastReconciledAt = new Date();
      this.lastError = null;
      return;
    }
    this.isRedisAvailable = false;
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

  private shouldSampleEvaluationMetrics(): boolean {
    if (!this.metricsEnabled()) {
      return false;
    }
    const sampleRate = this.configService.get<number>(
      'FEATURE_FLAG_METRICS_SAMPLE_RATE',
      0.01,
    );
    if (sampleRate >= 1) {
      return true;
    }
    if (sampleRate <= 0) {
      return false;
    }
    const stride = Math.max(1, Math.ceil(1 / sampleRate));
    this.evaluationMetricCounter += 1;
    return this.evaluationMetricCounter % stride === 0;
  }
}
