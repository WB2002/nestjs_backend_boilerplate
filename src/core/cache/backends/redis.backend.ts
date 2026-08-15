import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { CacheBackend } from '../types/cache-backend.interface';
import { CacheEntry } from '../types/cache.types';

export class RedisCacheBackend implements CacheBackend {
  private readonly logger = new Logger(RedisCacheBackend.name);

  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const raw = await this.redis.get(key);
    if (raw == null) {
      return null;
    }
    let entry: CacheEntry<T>;
    try {
      entry = JSON.parse(raw) as CacheEntry<T>;
    } catch (err) {
      this.logger.warn(
        `Invalid JSON for cache key ${key}: ${err instanceof Error ? err.message : err}`,
      );
      await this.redis.del(key);
      return null;
    }
    if (Date.now() >= entry.hardExpiresAt) {
      await this.redis.del(key);
      return null;
    }
    return entry;
  }

  async set<T>(
    key: string,
    entry: CacheEntry<T>,
    hardTtlMs: number,
  ): Promise<void> {
    const ttl = Math.max(1, Math.ceil(hardTtlMs));
    await this.redis.set(key, JSON.stringify(entry), 'PX', ttl);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async quit(): Promise<void> {
    await this.redis.quit();
  }
}
