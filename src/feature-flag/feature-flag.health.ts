import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Reports feature-flag subsystem status for observability.
 * Does NOT fail readiness — Redis outages must not take the app out of rotation.
 */
@Injectable()
export class FeatureFlagHealthIndicator {
  constructor(
    private readonly featureFlagService: FeatureFlagService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const status = this.featureFlagService.getHealthStatus();
    return this.healthIndicatorService.check(key).up({
      stale: status.stale,
      healthy: status.healthy,
      redisAvailable: status.redisAvailable,
      pubSubConnected: status.pubSubConnected,
      flagCount: status.flagCount,
      lastReconciledAt: status.lastReconciledAt,
      lastError: status.lastError,
    });
  }
}
