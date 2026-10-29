import {
  acquireRedisLoaderLock,
  releaseRedisLoaderLock,
} from '../redis-loader-lock';

function createMockRedis() {
  const store = new Map<string, string>();
  return {
    set: jest.fn(
      async (
        key: string,
        val: string,
        _px: string,
        _ttl: number,
        nx: string,
      ) => {
        if (nx === 'NX' && store.has(key)) {
          return null;
        }
        store.set(key, val);
        return 'OK';
      },
    ),
    eval: jest.fn(
      async (_script: string, _n: number, key: string, token: string) => {
        if (store.get(key) === token) {
          store.delete(key);
          return 1;
        }
        return 0;
      },
    ),
    store,
  };
}

describe('redis-loader-lock', () => {
  it('acquire succeeds only once for same key', async () => {
    const redis = createMockRedis();
    expect(
      await acquireRedisLoaderLock(redis as never, 'cache:lock:k', 't1', 5000),
    ).toBe(true);
    expect(
      await acquireRedisLoaderLock(redis as never, 'cache:lock:k', 't2', 5000),
    ).toBe(false);
  });

  it('release removes lock when token matches', async () => {
    const redis = createMockRedis();
    await acquireRedisLoaderLock(redis as never, 'cache:lock:k', 't1', 5000);
    await releaseRedisLoaderLock(redis as never, 'cache:lock:k', 't1');
    expect(redis.store.has('cache:lock:k')).toBe(false);
  });
});
