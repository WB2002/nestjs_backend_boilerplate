import { HealthCheckService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { ShutdownState } from '../core/shutdown';

describe('HealthController readiness', () => {
  let controller: HealthController;
  let health: { check: jest.Mock };
  let shutdownState: ShutdownState;
  let mongoose: { pingCheck: jest.Mock };
  let memory: { checkHeap: jest.Mock };
  let disk: { checkStorage: jest.Mock };
  let featureFlagHealth: { isHealthy: jest.Mock };

  beforeEach(() => {
    health = { check: jest.fn().mockResolvedValue({ status: 'ok' }) };
    mongoose = {
      pingCheck: jest.fn().mockResolvedValue({
        mongo: { status: 'up' },
      }),
    };
    memory = {
      checkHeap: jest.fn().mockResolvedValue({
        memory_heap: { status: 'up' },
      }),
    };
    disk = {
      checkStorage: jest.fn().mockResolvedValue({
        storage: { status: 'up' },
      }),
    };
    featureFlagHealth = {
      isHealthy: jest.fn().mockResolvedValue({ featureFlags: { status: 'up' } }),
    };
    shutdownState = new ShutdownState();
    controller = new HealthController(
      health as unknown as HealthCheckService,
      mongoose as any,
      memory as any,
      disk as any,
      {} as any,
      {
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as ConfigService,
      shutdownState,
      featureFlagHealth as any,
    );
  });

  it('ready() runs dependency checks when not shutting down', async () => {
    await controller.ready();
    expect(health.check).toHaveBeenCalledTimes(1);
    const checks = health.check.mock.calls[0][0] as Array<() => Promise<unknown>>;
    expect(checks.length).toBeGreaterThanOrEqual(3);
    await expect(checks[0]!()).resolves.toEqual({ mongo: { status: 'up' } });
  });

  it('ready() reports shuttingDown down when shutdown has begun', async () => {
    shutdownState.beginShutdown();
    await controller.ready();
    const checks = health.check.mock.calls[0][0] as Array<() => Promise<unknown>>;
    expect(checks).toHaveLength(1);
    await expect(checks[0]!()).resolves.toEqual({
      shuttingDown: {
        status: 'down',
        message: 'Application is shutting down',
      },
    });
  });
});
