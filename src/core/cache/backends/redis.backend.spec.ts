import Redis from 'ioredis';
import { RedisCacheBackend } from './redis.backend';
import { createRedisCacheBackend, tryConnectRedis } from './redis-test-utils';
import { CacheService } from '../cache.service';
import { DEFAULT_CACHE_KEY_PREFIX } from '../constants/cache.constants';
import { CacheEntry } from '../types/cache.types';

describe('RedisCacheBackend', () => {
  let redis: Redis | null = null;
  let backend: RedisCacheBackend | null = null;
  const prefix = `cache:test:${Date.now()}:`;

  beforeAll(async () => {
    redis = await tryConnectRedis();
    if (redis) {
      backend = createRedisCacheBackend(redis);
    }
  });

  afterAll(async () => {
    if (redis) {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length) {
        await redis.del(...keys);
      }
      await redis.quit();
    }
  });

  it('requires Redis for algorithm tests (skips when unavailable)', () => {
    if (!redis || !backend) {
      console.warn(
        '[RedisCacheBackend] Redis unreachable — Redis cache cases skipped',
      );
    }
    expect(true).toBe(true);
  });

  it('stores JSON envelope with PEXPIRE hard TTL', async () => {
    if (!redis || !backend) {
      return;
    }
    const key = `${prefix}swr`;
    const now = Date.now();
    const entry: CacheEntry<string> = {
      v: 'redis-val',
      softExpiresAt: now + 1000,
      hardExpiresAt: now + 5000,
    };
    await backend.set(key, entry, 5000);
    await expect(backend.get<string>(key)).resolves.toEqual(entry);
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5000);
  });

  it('does not overwrite unrelated rl: or revoked_jti: keys', async () => {
    if (!redis || !backend) {
      return;
    }
    await redis.set('rl:isolation-probe', 'rate-limit');
    await redis.set('revoked_jti:isolation-probe', 'true');
    const key = `${prefix}iso`;
    const now = Date.now();
    await backend.set(
      key,
      { v: 1, softExpiresAt: now + 1000, hardExpiresAt: now + 2000 },
      2000,
    );
    await expect(redis.get('rl:isolation-probe')).resolves.toBe('rate-limit');
    await expect(redis.get('revoked_jti:isolation-probe')).resolves.toBe(
      'true',
    );
    await redis.del('rl:isolation-probe', 'revoked_jti:isolation-probe', key);
  });

  it('CacheService prefixes with cache: against Redis', async () => {
    if (!redis || !backend) {
      return;
    }
    const service = new CacheService(backend, {
      keyPrefix: DEFAULT_CACHE_KEY_PREFIX,
    });
    const userKey = `svc-${Date.now()}`;
    await service.set(userKey, { ok: true }, { softTtlMs: 500, hardTtlMs: 2000 });
    const raw = await redis.get(`cache:${userKey}`);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({ v: { ok: true } });
    await service.delete(userKey);
  });
});
