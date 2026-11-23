import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisService } from '@/common/redis/redis.service';
import { FeatureFlagHealthIndicator } from '../feature-flag.health';
import { FeatureFlagModule } from '../feature-flag.module';
import { FeatureFlagService } from '../feature-flag.service';
import { FeatureFlagAudit } from '../schemas';

describe('FeatureFlagHealthIndicator', () => {
  it('resolves FeatureFlagHealthIndicator via FeatureFlagModule DI container', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FeatureFlagModule,
      ],
    })
      .overrideProvider(getModelToken(FeatureFlagAudit.name))
      .useValue({ create: jest.fn() })
      .overrideProvider(RedisService)
      .useValue({
        getClient: jest.fn(),
        createSubscriber: jest.fn(),
      })
      .compile();

    const indicator = moduleRef.get(FeatureFlagHealthIndicator);
    expect(indicator).toBeInstanceOf(FeatureFlagHealthIndicator);
    await moduleRef.close();
  });

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

    const outcome = await indicator.isHealthy('feature_flags');

    expect(featureFlagService.getHealthStatus).toHaveBeenCalled();
    expect(healthIndicatorService.check).toHaveBeenCalledWith('feature_flags');
    expect(outcome.feature_flags?.status).toBe('up');
    expect(outcome.feature_flags).toMatchObject({
      stale: false,
      redisAvailable: false,
    });
  });
});
