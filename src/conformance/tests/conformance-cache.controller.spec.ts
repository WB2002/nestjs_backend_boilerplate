import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule, CacheStorage } from '@/core/cache';
import { ConformanceCacheController } from '../conformance-cache.controller';
import { ConformanceCacheService } from '../conformance-cache.service';
import { withConformanceHarnessGuardStub } from './conformance-harness-guard-test.provider';

describe('ConformanceCacheController (HTTP)', () => {
  let testingModule: TestingModule;
  let testApplication: NestFastifyApplication;

  beforeEach(async () => {
    testingModule = await withConformanceHarnessGuardStub(
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          CacheModule.forRoot({
            storage: CacheStorage.Memory,
            ttlJitterRatio: 0,
          }),
        ],
        controllers: [ConformanceCacheController],
        providers: [ConformanceCacheService],
      }),
    ).compile();

    testApplication =
      testingModule.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
    testApplication.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await testApplication.init();
    await testApplication.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await testApplication.close();
  });

  it('POST /conformance/cache returns 200 with cache payload', async () => {
    const postResponse = await testApplication.inject({
      method: 'POST',
      url: '/conformance/cache',
      payload: {
        key: 'http-test-key',
        value: 'http-val',
        softTtlMs: 5_000,
        hardTtlMs: 10_000,
      },
    });

    expect(postResponse.statusCode).toBe(200);
    expect(postResponse.json()).toEqual({
      cachedValue: 'http-val',
      loaderCallCount: 1,
      isFromLoader: true,
    });
  });

  it('POST /conformance/cache maps loader failure to 502 with message Conformance loader failed', async () => {
    const postResponse = await testApplication.inject({
      method: 'POST',
      url: '/conformance/cache',
      payload: {
        key: 'http-fail-key',
        value: 'http-val',
        shouldFailLoader: true,
        softTtlMs: 5_000,
        hardTtlMs: 10_000,
      },
    });

    expect(postResponse.statusCode).toBe(502);
    const parsedResponseBody = postResponse.json();
    expect(parsedResponseBody.message).toBe('Conformance loader failed');
  });

  it('DELETE /conformance/cache/:key returns 200 with deleted: true', async () => {
    await testApplication.inject({
      method: 'POST',
      url: '/conformance/cache',
      payload: {
        key: 'http-del-key',
        value: 'http-val',
        softTtlMs: 5_000,
        hardTtlMs: 10_000,
      },
    });

    const deleteResponse = await testApplication.inject({
      method: 'DELETE',
      url: '/conformance/cache/http-del-key',
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ deleted: true });
  });

  it('POST /conformance/cache handles null value and shouldCacheNull', async () => {
    const postResponse = await testApplication.inject({
      method: 'POST',
      url: '/conformance/cache',
      payload: {
        key: 'http-null-key',
        value: null,
        shouldCacheNull: true,
        softTtlMs: 5_000,
        hardTtlMs: 10_000,
        negativeSoftTtlMs: 1_000,
        negativeHardTtlMs: 2_000,
      },
    });

    expect(postResponse.statusCode).toBe(200);
    expect(postResponse.json()).toEqual({
      cachedValue: null,
      loaderCallCount: 1,
      isFromLoader: true,
    });
  });

  it('rejects invalid request payloads with 400', async () => {
    const invalidResponse = await testApplication.inject({
      method: 'POST',
      url: '/conformance/cache',
      payload: {
        key: '',
        softTtlMs: 0,
        hardTtlMs: -1,
      },
    });

    expect(invalidResponse.statusCode).toBe(400);
  });
});
