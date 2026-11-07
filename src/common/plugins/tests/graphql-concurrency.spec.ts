jest.mock('@/core/telemetry/service-unavailable.metrics', () => ({
  emitServiceUnavailableMetric: jest.fn().mockResolvedValue(undefined),
}));

import { emitServiceUnavailableMetric } from '@/core/telemetry/service-unavailable.metrics';
import { recordGraphqlConcurrencyDenied } from '../graphql-concurrency/record-concurrency-denied';
import {
  applyGraphqlOverloadHttpHeaders,
  buildConcurrencyOverloadError,
} from '../graphql-concurrency/build-concurrency-overload-error';
import { GRAPHQL_OVERLOAD_EXTENSION_CODE } from '../graphql-concurrency/graphql-concurrency.constants';
import {
  acquireRedisConcurrency,
  releaseRedisConcurrency,
  ConcurrencyReleaseState,
} from '../graphql-concurrency/redis-concurrency';
import { consumeGraphqlBudget } from '../graphql-concurrency/consume-graphql-budget';
import {
  GQL_ACQUIRE_CONCURRENCY_LUA,
  GQL_CONSUME_BUDGET_LUA,
} from '../graphql-concurrency/graphql-lua.scripts';
import { resolveGraphqlSubject } from '../graphql-concurrency/resolve-graphql-subject';

function createMockRedis() {
  let concurrencyCount = 0;
  const budgetStore = new Map<string, number>();
  const ttls = new Map<string, number>();

  const decr = jest.fn(async (key: string) => {
    concurrencyCount = Math.max(0, concurrencyCount - 1);
    budgetStore.set(key, concurrencyCount);
    return concurrencyCount;
  });

  const evalFn = jest.fn(
    async (
      script: string,
      _numKeys: number,
      key: string,
      ...args: unknown[]
    ) => {
      if (script === GQL_ACQUIRE_CONCURRENCY_LUA) {
        const maxConcurrent = Number(args[0]);
        const ttlSec = Number(args[1]);
        concurrencyCount += 1;
        ttls.set(key, ttlSec);
        if (concurrencyCount > maxConcurrent) {
          concurrencyCount -= 1;
          return [0, concurrencyCount];
        }
        return [1, concurrencyCount];
      }
      if (script === GQL_CONSUME_BUDGET_LUA) {
        const cost = Number(args[0]);
        const budget = Number(args[1]);
        const windowSec = Number(args[2]);
        const currentUsage = budgetStore.get(key) ?? 0;
        if (currentUsage + cost > budget) {
          return [0, currentUsage];
        }
        const updatedUsage = currentUsage + cost;
        budgetStore.set(key, updatedUsage);
        if (updatedUsage === cost) {
          ttls.set(key, windowSec);
        }
        return [1, updatedUsage];
      }
      throw new Error(`Unknown script: ${script}`);
    },
  );

  return {
    eval: evalFn,
    decr,
    getConcurrency: () => concurrencyCount,
    setConcurrency: (count: number) => {
      concurrencyCount = count;
    },
    getBudget: (key: string) => budgetStore.get(key) ?? 0,
    setBudget: (key: string, used: number) => budgetStore.set(key, used),
    getTtl: (key: string) => ttls.get(key),
  };
}

describe('acquireRedisConcurrency', () => {
  it('sets EXPIRE on every successful incr', async () => {
    const redis = createMockRedis();
    const key = 'gql:concurrency:guest:x';
    const acquireOutcome = await acquireRedisConcurrency(
      redis as never,
      key,
      3,
      300,
    );
    expect(acquireOutcome.acquired).toBe(true);
    expect(acquireOutcome.isDegraded).toBe(false);
    expect(redis.eval).toHaveBeenCalledWith(
      GQL_ACQUIRE_CONCURRENCY_LUA,
      1,
      key,
      3,
      300,
    );
  });

  it('rejects when over max without leaving counter elevated', async () => {
    const redis = createMockRedis();
    await acquireRedisConcurrency(redis as never, 'k', 1, 300);
    const acquireOutcome = await acquireRedisConcurrency(
      redis as never,
      'k',
      1,
      300,
    );
    expect(acquireOutcome.acquired).toBe(false);
    expect(acquireOutcome.isDegraded).toBe(false);
    expect(redis.getConcurrency()).toBe(1);
  });

  it('acquire fails open when eval throws', async () => {
    const redis = {
      eval: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
    };
    const acquireOutcome = await acquireRedisConcurrency(
      redis as never,
      'k',
      3,
      300,
    );
    expect(acquireOutcome).toEqual({
      acquired: true,
      current: 0,
      isDegraded: true,
    });
  });
});

describe('releaseRedisConcurrency', () => {
  it('decrements once even if called twice', async () => {
    const redis = createMockRedis();
    const releaseState: ConcurrencyReleaseState = { released: false };
    await acquireRedisConcurrency(redis as never, 'k', 2, 300);
    await releaseRedisConcurrency(redis as never, 'k', releaseState);
    await releaseRedisConcurrency(redis as never, 'k', releaseState);
    expect(redis.decr).toHaveBeenCalledTimes(1);
  });

  it('release is a no-op after degraded acquire', async () => {
    const redis = createMockRedis();
    const releaseState: ConcurrencyReleaseState = {
      released: false,
      isDegraded: true,
    };
    await releaseRedisConcurrency(redis as never, 'k', releaseState);
    expect(redis.decr).not.toHaveBeenCalled();
    expect(releaseState.released).toBe(true);
  });
});

describe('consumeGraphqlBudget', () => {
  it('allows within budget and increments usage', async () => {
    const redis = createMockRedis();
    redis.setBudget('gql:budget:user:u-1', 50);
    const budgetOutcome = await consumeGraphqlBudget(
      redis as never,
      'gql:budget:user:u-1',
      20,
      1000,
      60,
    );
    expect(budgetOutcome).toEqual({
      allowed: true,
      used: 70,
      isDegraded: false,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      GQL_CONSUME_BUDGET_LUA,
      1,
      'gql:budget:user:u-1',
      20,
      1000,
      60,
    );
  });

  it('consumeGraphqlBudget denies over budget', async () => {
    const redis = createMockRedis();
    redis.setBudget('gql:budget:user:u-1', 990);
    const budgetOutcome = await consumeGraphqlBudget(
      redis as never,
      'gql:budget:user:u-1',
      20,
      1000,
      60,
    );
    expect(budgetOutcome).toEqual({
      allowed: false,
      used: 990,
      isDegraded: false,
    });
  });

  it('consumeGraphqlBudget fails open when eval throws', async () => {
    const redis = {
      eval: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
    };
    const budgetOutcome = await consumeGraphqlBudget(
      redis as never,
      'gql:budget:user:u-1',
      20,
      1000,
      60,
    );
    expect(budgetOutcome).toEqual({
      allowed: true,
      used: 0,
      isDegraded: true,
    });
  });
});

describe('resolveGraphqlSubject', () => {
  it('uses user id when authenticated', () => {
    expect(resolveGraphqlSubject({ userId: 'u-1' }).redisKey).toBe(
      'gql:concurrency:user:u-1',
    );
  });

  it('uses guest id when unauthenticated', () => {
    const guest = '550e8400-e29b-41d4-a716-446655440000';
    expect(resolveGraphqlSubject({ guestId: guest }).redisKey).toBe(
      `gql:concurrency:guest:${guest}`,
    );
  });

  it('falls back to shared anon bucket', () => {
    expect(resolveGraphqlSubject({}).redisKey).toBe(
      'gql:concurrency:anon:shared',
    );
  });
});

describe('buildConcurrencyOverloadError', () => {
  it('uses 503 extension code', () => {
    const err = buildConcurrencyOverloadError('guest-1');
    expect(err.extensions?.code).toBe(GRAPHQL_OVERLOAD_EXTENSION_CODE);
    expect(err.extensions?.http).toEqual({ status: 503 });
  });
});

describe('recordGraphqlConcurrencyDenied', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits ServiceUnavailable metric for graphql concurrency', async () => {
    await recordGraphqlConcurrencyDenied({ operationName: 'GetUser' });
    expect(emitServiceUnavailableMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'graphql_concurrency',
        path: '/graphql',
      }),
    );
  });
});

describe('applyGraphqlOverloadHttpHeaders', () => {
  it('sets Retry-After on reply', () => {
    const header = jest.fn();
    applyGraphqlOverloadHttpHeaders({ header }, 7);
    expect(header).toHaveBeenCalledWith('Retry-After', '7');
  });
});
