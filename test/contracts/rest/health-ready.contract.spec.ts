import Ajv from 'ajv';
import addFormats from 'ajv-formats';
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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FeatureFlagHealthIndicator } from '@/core/feature-flag';
import { ShutdownModule } from '../../../src/core/shutdown';
import { HealthController } from '@/core/health/health.controller';

describe('REST contract: GET /health/ready', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule, ShutdownModule],
      controllers: [HealthController],
      providers: [
        {
          provide: ConfigService,
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
  });

  afterEach(async () => {
    await app.close();
  });

  it('response matches health-ready JSON schema', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);

    const schema = JSON.parse(
      readFileSync(join(__dirname, 'schemas/health-ready.schema.json'), 'utf8'),
    ) as object;
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const body: unknown = response.json();
    expect(validate(body)).toBe(true);
  });
});
