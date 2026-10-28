import { CacheStorage } from '@/core/cache/enums/cache-storage.enum';
import { RateLimitStorage } from '@/core/rate-limiter/enums/rate-limit-storage.enum';
import {
  resolveCacheStorage,
  resolveRateLimitStorage,
} from '../resolve-coordination-storage';

describe('resolveRateLimitStorage', () => {
  it('defaults to Memory in non-production when unset', () => {
    expect(resolveRateLimitStorage({ nodeEnv: 'development' })).toBe(
      RateLimitStorage.Memory,
    );
  });

  it('defaults to Redis in production when unset', () => {
    expect(resolveRateLimitStorage({ nodeEnv: 'production' })).toBe(
      RateLimitStorage.Redis,
    );
  });

  it('honors explicit redis override in development', () => {
    expect(
      resolveRateLimitStorage({
        nodeEnv: 'development',
        rateLimitStorage: 'redis',
      }),
    ).toBe(RateLimitStorage.Redis);
  });

  it('honors explicit memory override in production', () => {
    expect(
      resolveRateLimitStorage({
        nodeEnv: 'production',
        rateLimitStorage: 'memory',
      }),
    ).toBe(RateLimitStorage.Memory);
  });

  it('rejects unknown storage', () => {
    expect(() =>
      resolveRateLimitStorage({ rateLimitStorage: 'dynamodb' }),
    ).toThrow(/memory|redis/i);
  });
});

describe('resolveCacheStorage', () => {
  it('defaults to Memory in test when unset', () => {
    expect(resolveCacheStorage({ nodeEnv: 'test' })).toBe(CacheStorage.Memory);
  });

  it('defaults to Redis in production when unset', () => {
    expect(resolveCacheStorage({ nodeEnv: 'production' })).toBe(
      CacheStorage.Redis,
    );
  });
});
