import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { GQL_ACQUIRE_CONCURRENCY_LUA } from './graphql-lua.scripts';

const logger = new Logger('redis-concurrency');

export type ConcurrencyReleaseState = {
  released: boolean;
  isDegraded?: boolean;
};

export type RedisConcurrencyOutcome = {
  acquired: boolean;
  current: number;
  isDegraded: boolean;
};

export async function acquireRedisConcurrency(
  redis: Redis,
  key: string,
  maxConcurrent: number,
  ttlSec: number,
): Promise<RedisConcurrencyOutcome> {
  try {
    const rawOutcome = (await redis.eval(
      GQL_ACQUIRE_CONCURRENCY_LUA,
      1,
      key,
      maxConcurrent,
      ttlSec,
    )) as [number, number];

    const [acquiredCode, currentCount] = rawOutcome;
    const isAcquired = acquiredCode === 1;

    return {
      acquired: isAcquired,
      current: Number(currentCount),
      isDegraded: false,
    };
  } catch (evalError) {
    logger.warn(
      `Failed to acquire Redis concurrency via Lua for key "${key}", failing open: ${evalError instanceof Error ? evalError.message : String(evalError)}`,
    );
    return {
      acquired: true,
      current: 0,
      isDegraded: true,
    };
  }
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
  if (state.isDegraded) {
    return;
  }
  try {
    await redis.decr(key);
  } catch (decrError) {
    logger.warn(
      `Failed to release Redis concurrency for key "${key}": ${decrError instanceof Error ? decrError.message : String(decrError)}`,
    );
  }
}
