import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { CacheLoaderLock } from './cache-loader-lock.interface';
import {
  acquireRedisLoaderLock,
  releaseRedisLoaderLock,
} from './redis-loader-lock';

export class RedisCacheLoaderLock implements CacheLoaderLock {
  constructor(private readonly redis: Redis) {}

  async tryAcquire(lockKey: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const ok = await acquireRedisLoaderLock(this.redis, lockKey, token, ttlMs);
    return ok ? token : null;
  }

  async release(lockKey: string, token: string): Promise<void> {
    await releaseRedisLoaderLock(this.redis, lockKey, token);
  }
}
