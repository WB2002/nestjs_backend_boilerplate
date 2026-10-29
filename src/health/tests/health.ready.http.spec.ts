import { ConfigService } from '@nestjs/config';
import {
  DiskHealthIndicator,
  MemoryHealthIndicator,
  MicroserviceHealthIndicator,
  MongooseHealthIndicator,
  TerminusModule,
} from '@nestjs/terminus';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { HealthController } from '../health.controller';
import { ShutdownModule, ShutdownState } from '../../core/shutdown';
import { FeatureFlagHealthIndicator } from '../../feature-flag';

/**
 * Wire-level test of the real HealthController: proves Terminus maps the
 * shutdown indicator to HTTP 503. Dependency indicators are mocked so the
 * suite needs no Mongo/Redis/Postgres.
 */
describe('GET /health/ready (HTTP)', () => {
  let app: NestFastifyApplication;
  let shutdownState: ShutdownState;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule, ShutdownModule],
      controllers: [HealthController],
      providers: [
        {
          provide: ConfigService,
          // No REDIS_HOST / POSTGRES_DB, so those optional checks are skipped.
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: FeatureFlagHealthIndicator,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue({
              feature_flags: {
                status: 'up',
                stale: true,
                healthy: false,
                redisAvailable: false,
                pubSubConnected: false,
                flagCount: 0,
                lastReconciledAt: null,
                lastError: null,
              },
            }),
          },
        },
      ],
    })
      .overrideProvider(MongooseHealthIndicator)
      .useValue({
        pingCheck: jest.fn().mockResolvedValue({ mongo: { status: 'up' } }),
      })
      .overrideProvider(MemoryHealthIndicator)
      .useValue({
        checkHeap: jest
          .fn()
          .mockResolvedValue({ memory_heap: { status: 'up' } }),
      })
      .overrideProvider(DiskHealthIndicator)
      .useValue({
        checkStorage: jest
          .fn()
          .mockResolvedValue({ storage: { status: 'up' } }),
      })
      .overrideProvider(MicroserviceHealthIndicator)
      .useValue({ pingCheck: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    shutdownState = app.get(ShutdownState);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 while healthy and not shutting down', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.details.shuttingDown).toBeUndefined();
    expect(body.details.mongo).toEqual({ status: 'up' });
  });

  it('returns 503 with shuttingDown once shutdown has begun', async () => {
    shutdownState.beginShutdown();

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({
      status: 'error',
      details: {
        shuttingDown: {
          status: 'down',
          message: 'Application is shutting down',
        },
      },
    });
  });

  it('does not report shuttingDown on /health during shutdown', async () => {
    shutdownState.beginShutdown();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).details.shuttingDown).toBeUndefined();
  });
});
