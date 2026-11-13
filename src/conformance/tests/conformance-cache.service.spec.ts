import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule, CacheStorage } from '@/core/cache';
import { ConformanceCacheService } from '../conformance-cache.service';

describe('ConformanceCacheService', () => {
  let testingModule: TestingModule;
  let service: ConformanceCacheService;

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CacheModule.forRoot({
          storage: CacheStorage.Memory,
          ttlJitterRatio: 0,
        }),
      ],
      providers: [ConformanceCacheService],
    }).compile();

    service = testingModule.get<ConformanceCacheService>(
      ConformanceCacheService,
    );
  });

  afterEach(async () => {
    await testingModule.close();
  });

  it('first call runs loader', async () => {
    const serviceResponse = await service.getOrSet({
      key: 'cache-key-1',
      value: 'v1',
      softTtlMs: 5_000,
      hardTtlMs: 10_000,
    });

    expect(serviceResponse).toEqual({
      cachedValue: 'v1',
      loaderCallCount: 1,
      isFromLoader: true,
    });
  });

  it('second call within soft TTL hits cache', async () => {
    const initialResponse = await service.getOrSet({
      key: 'cache-key-2',
      value: 'v1',
      softTtlMs: 5_000,
      hardTtlMs: 10_000,
    });
    expect(initialResponse.loaderCallCount).toBe(1);

    const cachedResponse = await service.getOrSet({
      key: 'cache-key-2',
      value: 'v2',
      softTtlMs: 5_000,
      hardTtlMs: 10_000,
    });

    expect(cachedResponse).toEqual({
      cachedValue: 'v1',
      loaderCallCount: 1,
      isFromLoader: false,
    });
  });

  it('parallel calls single-flight', async () => {
    const parallelRequests = Array.from({ length: 5 }, () =>
      service.getOrSet({
        key: 'cache-key-parallel',
        value: 'v1',
        loaderDelayMs: 50,
        softTtlMs: 5_000,
        hardTtlMs: 10_000,
      }),
    );

    const responses = await Promise.all(parallelRequests);

    expect(responses).toHaveLength(5);
    for (const singleResponse of responses) {
      expect(singleResponse.cachedValue).toBe('v1');
      expect(singleResponse.loaderCallCount).toBe(1);
    }
  });

  it('shouldCacheNull caches absence', async () => {
    const initialResponse = await service.getOrSet({
      key: 'cache-key-null',
      value: null,
      shouldCacheNull: true,
      softTtlMs: 5_000,
      hardTtlMs: 10_000,
      negativeSoftTtlMs: 1_000,
      negativeHardTtlMs: 2_000,
    });

    expect(initialResponse).toEqual({
      cachedValue: null,
      loaderCallCount: 1,
      isFromLoader: true,
    });

    const cachedResponse = await service.getOrSet({
      key: 'cache-key-null',
      value: 'unexpected-value',
      shouldCacheNull: true,
      softTtlMs: 5_000,
      hardTtlMs: 10_000,
      negativeSoftTtlMs: 1_000,
      negativeHardTtlMs: 2_000,
    });

    expect(cachedResponse).toEqual({
      cachedValue: null,
      loaderCallCount: 1,
      isFromLoader: false,
    });
  });

  it('loader failure propagates', async () => {
    await expect(
      service.getOrSet({
        key: 'cache-key-fail',
        value: 'v1',
        shouldFailLoader: true,
        softTtlMs: 5_000,
        hardTtlMs: 10_000,
      }),
    ).rejects.toThrow('Conformance loader failed');
  });

  it('reset clears counter and entry', async () => {
    const initialResponse = await service.getOrSet({
      key: 'cache-key-reset',
      value: 'v1',
      softTtlMs: 5_000,
      hardTtlMs: 10_000,
    });
    expect(initialResponse.loaderCallCount).toBe(1);

    await service.reset('cache-key-reset');

    const nextResponse = await service.getOrSet({
      key: 'cache-key-reset',
      value: 'v2',
      softTtlMs: 5_000,
      hardTtlMs: 10_000,
    });

    expect(nextResponse).toEqual({
      cachedValue: 'v2',
      loaderCallCount: 1,
      isFromLoader: true,
    });
  });
});
