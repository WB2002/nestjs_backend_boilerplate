import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Reports feature-flag subsystem status for observability.
 * Does NOT fail readiness — Redis outages must not take the app out of rotation.
 */
@Injectable()
export class FeatureFlagHealthIndicator extends HealthIndicator {
  constructor(private readonly featureFlagService: FeatureFlagService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const status = this.featureFlagService.getHealthStatus();
    const result = this.getStatus(key, true, {
      stale: status.stale,
      healthy: status.healthy,
      redisAvailable: status.redisAvailable,
      pubSubConnected: status.pubSubConnected,
      flagCount: status.flagCount,
      lastReconciledAt: status.lastReconciledAt,
      lastError: status.lastError,
    });
    // Always up for Terminus aggregation — stale is informational only.
    if (!result[key]) {
      throw new HealthCheckError('Feature flags health check failed', result);
    }
    return result;
  }
}
