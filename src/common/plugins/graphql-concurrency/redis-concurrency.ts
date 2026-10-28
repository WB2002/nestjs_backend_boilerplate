import type Redis from 'ioredis';

export type ConcurrencyReleaseState = { released: boolean };

export async function acquireRedisConcurrency(
  redis: Redis,
  key: string,
  maxConcurrent: number,
  ttlSec: number,
): Promise<
  { acquired: true; current: number } | { acquired: false; current: number }
> {
  const current = await redis.incr(key);
  await redis.expire(key, ttlSec);
  if (current > maxConcurrent) {
    await redis.decr(key);
    return { acquired: false, current: current - 1 };
  }
  return { acquired: true, current };
}

export async function releaseRedisConcurrency(
  redis: Redis,
  key: string,
  state: ConcurrencyReleaseState,
): Promise<void> {
  if (state.released) {
    return;
  }
  state.released = true;
  await redis.decr(key);
}
