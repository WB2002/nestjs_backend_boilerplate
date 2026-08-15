import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { RedisRateLimitBackend } from './redis.backend';

export function redisConnectionOptions(): { host: string; port: number } {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  };
}

/**
 * Synchronous TCP probe so suites can use `describe.skip` (not silent pass)
 * when Redis is down. Prefer `tryConnectRedis` for the real ioredis client.
 */
export function isRedisReachable(timeoutMs = 500): boolean {
  const { host, port } = redisConnectionOptions();
  const script = `
    const net = require('net');
    const socket = net.connect(${port}, ${JSON.stringify(host)}, () => {
      socket.end();
      process.exit(0);
    });
    socket.on('error', () => process.exit(1));
    setTimeout(() => process.exit(1), ${timeoutMs});
  `;
  try {
    execFileSync(process.execPath, ['-e', script], {
      stdio: 'ignore',
      timeout: timeoutMs + 1_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** `describe` when Redis answers on REDIS_HOST/PORT; otherwise `describe.skip`. */
export const describeWithRedis: typeof describe = isRedisReachable()
  ? describe
  : describe.skip;

/**
 * Tries to open a Redis connection. Returns null when Redis is unreachable.
 */
export async function tryConnectRedis(): Promise<Redis | null> {
  const { host, port } = redisConnectionOptions();
  const redis = new Redis({
    host,
    port,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    await redis.ping();
    return redis;
  } catch {
    redis.disconnect(false);
    return null;
  }
}

export async function createRedisBackend(
  redis: Redis,
): Promise<RedisRateLimitBackend> {
  const backend = new RedisRateLimitBackend(redis);
  await backend.ensureScriptsLoaded();
  return backend;
}

export function testKeyPrefix(): string {
  return `rl-test:${randomUUID()}`;
}

export function scenarioKey(prefix: string, scenarioName: string): string {
  return `${prefix}:${scenarioName}`;
}
