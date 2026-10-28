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
} from '../graphql-concurrency/redis-concurrency';
import { resolveGraphqlSubject } from '../graphql-concurrency/resolve-graphql-subject';

function createMockRedis() {
  let value = 0;
  return {
    incr: jest.fn(async () => {
      value += 1;
      return value;
    }),
    decr: jest.fn(async () => {
      value = Math.max(0, value - 1);
      return value;
    }),
    expire: jest.fn(async () => 1),
    getValue: () => value,
  };
}

describe('acquireRedisConcurrency', () => {
  it('sets EXPIRE on every successful incr', async () => {
    const redis = createMockRedis();
    const key = 'gql:concurrency:guest:x';
    const result = await acquireRedisConcurrency(redis as never, key, 3, 300);
    expect(result.acquired).toBe(true);
    expect(redis.expire).toHaveBeenCalledWith(key, 300);
  });

  it('rejects when over max without leaving counter elevated', async () => {
    const redis = createMockRedis();
    await acquireRedisConcurrency(redis as never, 'k', 1, 300);
    const result = await acquireRedisConcurrency(redis as never, 'k', 1, 300);
    expect(result.acquired).toBe(false);
    expect(redis.getValue()).toBe(1);
  });
});

describe('releaseRedisConcurrency', () => {
  it('decrements once even if called twice', async () => {
    const redis = createMockRedis();
    const state = { released: false };
    await acquireRedisConcurrency(redis as never, 'k', 2, 300);
    await releaseRedisConcurrency(redis as never, 'k', state);
    await releaseRedisConcurrency(redis as never, 'k', state);
    expect(redis.decr).toHaveBeenCalledTimes(1);
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
    expect(resolveGraphqlSubject({}).redisKey).toBe('gql:concurrency:anon:shared');
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
      expect.objectContaining({ reason: 'graphql_concurrency', path: '/graphql' }),
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
