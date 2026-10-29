import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_FEATURE_FLAG_RECONCILE_MS,
  FeatureFlagLogEvent,
} from './constants';
import { FeatureFlagCache } from './feature-flag.cache';
import { emitFeatureFlagMetrics } from './feature-flag.metrics';
import { FeatureFlagRepository } from './feature-flag.repository';

export interface IFeatureFlagReconcileResult {
  success: boolean;
  flagCount: number;
  skipped: number;
  error: string | null;
}

@Injectable()
export class FeatureFlagReconciler {
  private readonly logger = new Logger(FeatureFlagReconciler.name);
  private timer: NodeJS.Timeout | null = null;
  private environment = '';
  private cache: FeatureFlagCache | null = null;
  private onResult:
    | ((reconcileResult: IFeatureFlagReconcileResult) => void)
    | null = null;

  constructor(
    private readonly repository: FeatureFlagRepository,
    private readonly configService: ConfigService,
  ) {}

  start(params: {
    environment: string;
    cache: FeatureFlagCache;
    onResult: (reconcileResult: IFeatureFlagReconcileResult) => void;
  }): void {
    this.environment = params.environment;
    this.cache = params.cache;
    this.onResult = params.onResult;
    this.stop();
    const intervalMs = this.resolveIntervalMs();
    this.timer = setInterval(() => {
      void this.reconcile();
    }, intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reconcile(): Promise<IFeatureFlagReconcileResult> {
    if (!this.cache) {
      return {
        success: false,
        flagCount: 0,
        skipped: 0,
        error: 'cache_not_ready',
      };
    }

    try {
      const flags = await this.repository.loadAllFlags(this.environment);
      const skippedInvalidFlags = this.cache.replaceAll(flags);
      const reconcileResult: IFeatureFlagReconcileResult = {
        success: true,
        flagCount: this.cache.size(),
        skipped: skippedInvalidFlags,
        error: null,
      };
      this.logger.log(
        `${FeatureFlagLogEvent.RECONCILIATION} count=${reconcileResult.flagCount} skipped=${skippedInvalidFlags}`,
      );
      void emitFeatureFlagMetrics({
        enabled: this.metricsEnabled(),
        name: 'feature_flag_reconciliation_total',
      });
      this.onResult?.(reconcileResult);
      return reconcileResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `${FeatureFlagLogEvent.REDIS_UNAVAILABLE}: reconcile failed: ${message}`,
      );
      void emitFeatureFlagMetrics({
        enabled: this.metricsEnabled(),
        name: 'feature_flag_redis_errors',
      });
      const reconcileResult: IFeatureFlagReconcileResult = {
        success: false,
        flagCount: this.cache.size(),
        skipped: 0,
        error: message,
      };
      this.onResult?.(reconcileResult);
      return reconcileResult;
    }
  }

  private resolveIntervalMs(): number {
    const raw = this.configService.get<string | number>(
      'FEATURE_FLAG_RECONCILE_MS',
    );
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 5_000) {
      return DEFAULT_FEATURE_FLAG_RECONCILE_MS;
    }
    return parsed;
  }

  private metricsEnabled(): boolean {
    return this.configService.get<string>('FEATURE_FLAG_METRICS') !== 'false';
  }
}
