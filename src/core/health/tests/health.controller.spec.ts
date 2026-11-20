import { HealthCheckService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../health.controller';
import { ShutdownState } from '@/core/shutdown';

describe('HealthController', () => {
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
      isHealthy: jest
        .fn()
        .mockResolvedValue({ featureFlags: { status: 'up' } }),
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

  describe('live()', () => {
    it('returns ok without calling health.check', () => {
      const liveResponse = controller.live();
      expect(liveResponse).toEqual({ status: 'ok' });
      expect(health.check).not.toHaveBeenCalled();
    });

    it('is 503 while shutting down', () => {
      shutdownState.beginShutdown();
      expect(() => controller.live()).toThrow(ServiceUnavailableException);
      expect(health.check).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('ready() runs dependency checks when not shutting down', async () => {
      await controller.ready();
      expect(health.check).toHaveBeenCalledTimes(1);
      const checks = health.check.mock.calls[0][0] as Array<
        () => Promise<unknown>
      >;
      expect(checks.length).toBeGreaterThanOrEqual(3);
      await expect(checks[0]!()).resolves.toEqual({ mongo: { status: 'up' } });
    });

    it('ready() reports shuttingDown down when shutdown has begun', async () => {
      shutdownState.beginShutdown();
      await controller.ready();
      const checks = health.check.mock.calls[0][0] as Array<
        () => Promise<unknown>
      >;
      expect(checks).toHaveLength(1);
      await expect(checks[0]!()).resolves.toEqual({
        shuttingDown: {
          status: 'down',
          message: 'Application is shutting down',
        },
      });
    });

    it('ready() called twice within the TTL calls health.check once', async () => {
      const firstCheckResponse = await controller.ready();
      const secondCheckResponse = await controller.ready();

      expect(firstCheckResponse).toEqual({ status: 'ok' });
      expect(secondCheckResponse).toEqual({ status: 'ok' });
      expect(health.check).toHaveBeenCalledTimes(1);
    });

    it('strips dependency details in production minimal mode', async () => {
      const productionController = new HealthController(
        health as unknown as HealthCheckService,
        mongoose as any,
        memory as any,
        disk as any,
        {} as any,
        {
          get: jest.fn((key: string) =>
            key === 'NODE_ENV' ? 'production' : undefined,
          ),
        } as unknown as ConfigService,
        shutdownState,
        featureFlagHealth as any,
      );
      health.check.mockResolvedValue({
        status: 'ok',
        details: { mongo: { status: 'up' } },
      });
      await expect(productionController.ready()).resolves.toEqual({
        status: 'ok',
        details: {},
      });
    });
  });

  describe('onModuleDestroy()', () => {
    it('closes the Postgres pool if initialized', async () => {
      const mockEnd = jest.fn().mockResolvedValue(undefined);
      (controller as any).pgPool = { end: mockEnd };
      await controller.onModuleDestroy();
      expect(mockEnd).toHaveBeenCalledTimes(1);
      expect((controller as any).pgPool).toBeUndefined();
    });

    it('does nothing if pgPool is undefined', async () => {
      await expect(controller.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  describe('pingPostgres()', () => {
    it('returns status up on successful query', async () => {
      const mockQuery = jest
        .fn()
        .mockResolvedValue({ rows: [{ '?column?': 1 }] });
      (controller as any).pgPool = { query: mockQuery, on: jest.fn() };
      const pingResponse = await (controller as any).pingPostgres();
      expect(pingResponse).toEqual({ postgres: { status: 'up' } });
      expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
    });

    it('returns status down on query failure', async () => {
      const mockQuery = jest
        .fn()
        .mockRejectedValue(new Error('connection timeout'));
      (controller as any).pgPool = { query: mockQuery, on: jest.fn() };
      const pingFailureResponse = await (controller as any).pingPostgres();
      expect(pingFailureResponse).toEqual({
        postgres: { status: 'down', message: 'connection timeout' },
      });
    });
  });
});
