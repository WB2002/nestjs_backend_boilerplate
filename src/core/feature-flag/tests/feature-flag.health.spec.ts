import { FeatureFlagHealthIndicator } from '../feature-flag.health';
import { FeatureFlagService } from '../feature-flag.service';
import { HealthIndicatorService } from '@nestjs/terminus';

describe('FeatureFlagHealthIndicator', () => {
  it('isHealthy always reports up with feature-flag metadata', async () => {
    const status = {
      stale: false,
      healthy: true,
      redisAvailable: false,
      pubSubConnected: false,
      flagCount: 3,
      lastReconciledAt: '2026-01-01T00:00:00.000Z',
      lastError: null as string | null,
    };

    const featureFlagService = {
      getHealthStatus: jest.fn().mockReturnValue(status),
    } as unknown as FeatureFlagService;

    const healthIndicatorService = {
      check: jest.fn().mockReturnValue({
        up: jest.fn().mockReturnValue({
          feature_flags: {
            status: 'up',
            stale: status.stale,
            healthy: status.healthy,
            redisAvailable: status.redisAvailable,
            pubSubConnected: status.pubSubConnected,
            flagCount: status.flagCount,
            lastReconciledAt: status.lastReconciledAt,
            lastError: status.lastError,
          },
        }),
      }),
    } as unknown as HealthIndicatorService;

    const indicator = new FeatureFlagHealthIndicator(
      featureFlagService,
      healthIndicatorService,
    );

    const result = await indicator.isHealthy('feature_flags');

    expect(featureFlagService.getHealthStatus).toHaveBeenCalled();
    expect(healthIndicatorService.check).toHaveBeenCalledWith('feature_flags');
    expect(result.feature_flags?.status).toBe('up');
    expect(result.feature_flags).toMatchObject({
      stale: false,
      redisAvailable: false,
    });
  });
});
