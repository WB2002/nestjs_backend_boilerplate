import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { AuthModule } from '@/auth/auth.module';
import { Session } from '@/auth/schemas/session.schema';
import { User } from '@/auth/schemas/user.schema';
import { CategoriesModule } from '@/categories/categories.module';
import {
  CountryAccessGuard,
  CountryAccessModule,
} from '@/common/country-access';
import { CountryAccessDocument } from '@/common/country-access/persistence/mongo/country-access.schema';
import { RedisModule } from '@/common/redis/redis.module';
import { RedisService } from '@/common/redis/redis.service';
import { UploadsModule } from '@/common/uploads/uploads.module';
import { ConformanceModule } from '@/conformance';
import { BackgroundJobsModule } from '@/core/background-jobs';
import { CacheModule, CacheStorage } from '@/core/cache';
import { CaptchaModule } from '@/core/captcha';
import { CsrfModule } from '@/core/csrf';
import { FeatureFlagModule } from '@/core/feature-flag';
import { FeatureFlagAudit } from '@/core/feature-flag/schemas';
import { HealthModule } from '@/core/health/health.module';
import { HttpClientModule } from '@/core/http-client';
import { NotificationModule } from '@/core/notification';
import { InboundPriorityBulkheadGuard, OverloadModule } from '@/core/overload';
import {
  RateLimitGuard,
  RateLimiterModule,
  RateLimitStorage,
} from '@/core/rate-limiter';
import { RequestDeadlineModule } from '@/core/request-deadline';
import { ShutdownModule } from '@/core/shutdown';
import { WebSocketModule } from '@/core/websocket/websocket.module';
import { ExampleJobsHandlersModule } from '@/example/example-jobs-handlers.module';
import { ExampleJobsModule } from '@/example/example-jobs.module';
import { ExampleModule } from '@/example/example.module';
import { ExampleRealtimeModule } from '@/example/example-realtime.module';

const MOCK_REDIS_SERVICE = {
  getClient: jest.fn(),
  createSubscriber: jest.fn(),
  duplicate: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  onModuleDestroy: jest.fn(),
};

const MOCK_MODEL = {
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  deleteOne: jest.fn(),
  updateOne: jest.fn(),
};

const MOCK_CONNECTION = {
  readyState: 1,
  close: jest.fn(),
};

const TEST_ENV: ReadonlyArray<readonly [string, string]> = [
  ['NODE_ENV', 'test'],
  ['JWT_PRIVATE_KEY', 'test-private-key'],
  ['JWT_PUBLIC_KEY', 'test-public-key'],
  ['COOKIE_SECRET', 'test-cookie-secret'],
  ['ACCESS_TOKEN_TTL', '900'],
  ['SESSION_TTL', '604800'],
  ['MONGO_URI', 'mongodb://127.0.0.1:27017/test'],
  ['REDIS_HOST', '127.0.0.1'],
  ['REDIS_PORT', '6379'],
  ['GEOIP_DATABASE_PATH', './nonexistent-geoip.mmdb'],
  ['HCAPTCHA_SECRET', 'test-hcaptcha-secret'],
  ['CACHE_STORAGE', 'memory'],
  ['RATE_LIMIT_STORAGE', 'memory'],
];

describe('NestJS module DI resolution', () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const [key, value] of TEST_ENV) {
      originalEnv.set(key, Reflect.get(process.env, key) as string | undefined);
      Reflect.set(process.env, key, value);
    }
  });

  afterAll(() => {
    for (const [key, value] of originalEnv.entries()) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        Reflect.set(process.env, key, value);
      }
    }
  });

  it('compiles AppModule and resolves all providers, controllers, and global guards', async () => {
    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getConnectionToken())
      .useValue(MOCK_CONNECTION)
      .overrideProvider(getModelToken(User.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(getModelToken(Session.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(getModelToken(CountryAccessDocument.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(getModelToken(FeatureFlagAudit.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(RedisService)
      .useValue(MOCK_REDIS_SERVICE)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves HealthModule with global ConfigModule and ShutdownModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ShutdownModule,
        HealthModule,
      ],
    })
      .overrideProvider(getModelToken(FeatureFlagAudit.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(RedisService)
      .useValue(MOCK_REDIS_SERVICE)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves AuthModule with global platform modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RedisModule,
        CacheModule.forRoot({ storage: CacheStorage.Memory }),
        CsrfModule.forRoot(),
        AuthModule,
      ],
    })
      .overrideProvider(getModelToken(User.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(getModelToken(Session.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(RedisService)
      .useValue(MOCK_REDIS_SERVICE)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves CountryAccessModule with global ConfigModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        CountryAccessModule,
      ],
    })
      .overrideProvider(getModelToken(CountryAccessDocument.name))
      .useValue(MOCK_MODEL)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves UploadsModule standalone', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UploadsModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves CaptchaModule with global ConfigModule and HttpClientModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        HttpClientModule,
        CaptchaModule,
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves NotificationModule with global HttpClientModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HttpClientModule, NotificationModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves CategoriesModule standalone', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CategoriesModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves ConformanceModule with global ConfigModule and CacheModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        CacheModule.forRoot({ storage: CacheStorage.Memory }),
        ConformanceModule,
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves WebSocketModule with global platform modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RedisModule,
        CacheModule.forRoot({ storage: CacheStorage.Memory }),
        CsrfModule.forRoot(),
        WebSocketModule,
      ],
    })
      .overrideProvider(getModelToken(User.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(getModelToken(Session.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(RedisService)
      .useValue(MOCK_REDIS_SERVICE)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves ExampleModule with global ConfigModule, HttpClientModule, and NotificationModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        HttpClientModule,
        NotificationModule,
        ExampleModule,
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves ExampleRealtimeModule with global platform modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RedisModule,
        CacheModule.forRoot({ storage: CacheStorage.Memory }),
        CsrfModule.forRoot(),
        ExampleRealtimeModule,
      ],
    })
      .overrideProvider(getModelToken(User.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(getModelToken(Session.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(RedisService)
      .useValue(MOCK_REDIS_SERVICE)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves InboundPriorityBulkheadGuard as APP_GUARD with OverloadModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OverloadModule.forRoot()],
      providers: [
        { provide: APP_GUARD, useClass: InboundPriorityBulkheadGuard },
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves CountryAccessGuard as APP_GUARD with CountryAccessModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        CountryAccessModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: CountryAccessGuard }],
    })
      .overrideProvider(getModelToken(CountryAccessDocument.name))
      .useValue(MOCK_MODEL)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves RateLimitGuard as APP_GUARD with RateLimiterModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RateLimiterModule.forRoot({ storage: RateLimitStorage.Memory }),
      ],
      providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves CacheModule.forRoot(memory) standalone without ConfigModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.forRoot({ storage: CacheStorage.Memory })],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves RateLimiterModule.forRoot(memory) standalone without ConfigModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RateLimiterModule.forRoot({ storage: RateLimitStorage.Memory }),
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves BackgroundJobsModule, ExampleJobsHandlersModule, and ExampleJobsModule', async () => {
    // jest/nestjs-bullmq-shim.cjs stubs BullModule.registerQueue() as an empty module,
    // so supply the BullMQ Queue token here to verify the rest of the DI graph.
    @Global()
    @Module({
      providers: [
        { provide: Queue, useValue: { add: jest.fn(), close: jest.fn() } },
      ],
      exports: [Queue],
    })
    class BullQueueTestShimModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RedisModule,
        BullQueueTestShimModule,
        BackgroundJobsModule.forRootAsync({ registerWorker: true }),
        ExampleJobsHandlersModule,
        ExampleJobsModule,
      ],
    })
      .overrideProvider(RedisService)
      .useValue(MOCK_REDIS_SERVICE)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves OverloadModule, CsrfModule, RequestDeadlineModule, and FeatureFlagModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        OverloadModule.forRoot(),
        CsrfModule.forRoot(),
        RequestDeadlineModule.forRoot(),
        FeatureFlagModule,
      ],
    })
      .overrideProvider(getModelToken(FeatureFlagAudit.name))
      .useValue(MOCK_MODEL)
      .overrideProvider(RedisService)
      .useValue(MOCK_REDIS_SERVICE)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
