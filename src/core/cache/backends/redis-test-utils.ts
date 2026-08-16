import Redis from 'ioredis';
import { RedisCacheBackend } from './redis.backend';

/**
 * Tries to open a Redis connection. Returns null when Redis is unreachable
 * so suites can skip without failing CI/local runs without Redis.
 */
export async function tryConnectRedis(): Promise<Redis | null> {
  const host = process.env.REDIS_HOST ?? '127.0.0.1';
  const port = Number(process.env.REDIS_PORT ?? 6379);
  const redis = new Redis({
    host,
    port,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 500,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  redis.on('error', () => {
    /* suppress connection noise when Redis is down */
  });
  try {
    await redis.connect();
    await redis.ping();
    return redis;
  } catch {
    try {
      redis.disconnect(false);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function createRedisCacheBackend(redis: Redis): RedisCacheBackend {
  return new RedisCacheBackend(redis);
}
