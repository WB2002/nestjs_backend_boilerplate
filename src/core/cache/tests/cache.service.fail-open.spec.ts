import { CacheService } from '../cache.service';
import { CacheLoaderLock } from '../lock/cache-loader-lock.interface';
import { CacheBackend } from '../types/cache-backend.interface';
import { CacheEntry, CacheModuleOptions } from '../types/cache.types';

class ThrowingCacheBackend implements CacheBackend {
  async get<T>(_key: string): Promise<CacheEntry<T> | null> {
    throw new Error('Redis connection lost on get');
  }

  async set<T>(
    _key: string,
    _entry: CacheEntry<T>,
    _ttlMs: number,
  ): Promise<void> {
    throw new Error('Redis connection lost on set');
  }

  async delete(_key: string): Promise<void> {
    throw new Error('Redis connection lost on delete');
  }
}

class ThrowingCacheLoaderLock implements CacheLoaderLock {
  async tryAcquire(_lockKey: string, _ttlMs: number): Promise<string | null> {
    throw new Error('Redis connection lost on tryAcquire');
  }

  async release(_lockKey: string, _token: string): Promise<void> {
    throw new Error('Redis connection lost on release');
  }
}

function createService(
  backend: CacheBackend = new ThrowingCacheBackend(),
  loaderLock?: CacheLoaderLock,
  options: CacheModuleOptions = {},
): CacheService {
  return new CacheService(
    backend,
    {
      keyPrefix: 'test:',
      defaultSoftTtlMs: 1000,
      defaultHardTtlMs: 5000,
      loaderWaitMs: 500,
      ...options,
    },
    loaderLock,
  );
}

describe('CacheService fail-open', () => {
  const ttl = { softTtlMs: 50, hardTtlMs: 200 };

  it('get returns null when backend throws', async () => {
    const service = createService(
      new ThrowingCacheBackend(),
      new ThrowingCacheLoaderLock(),
    );
    await expect(service.get('k')).resolves.toBeNull();
  });

  it('set and delete resolve when backend throws', async () => {
    const service = createService(
      new ThrowingCacheBackend(),
      new ThrowingCacheLoaderLock(),
    );
    await expect(service.set('k', 'v', ttl)).resolves.toBeUndefined();
    await expect(service.delete('k')).resolves.toBeUndefined();
  });

  it('getOrSet returns loader value when backend and lock throw', async () => {
    const service = createService(
      new ThrowingCacheBackend(),
      new ThrowingCacheLoaderLock(),
    );
    const loader = jest.fn().mockResolvedValue(42);
    const loadedValue = await service.getOrSet('k', loader, ttl);
    expect(loadedValue).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('concurrent getOrSet during outage single-flights the loader', async () => {
    const service = createService(
      new ThrowingCacheBackend(),
      new ThrowingCacheLoaderLock(),
    );
    let resolveLoader!: (v: number) => void;
    const loader = jest.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const p1 = service.getOrSet('k', loader, ttl);
    const p2 = service.getOrSet('k', loader, ttl);

    const deadline = Date.now() + 500;
    while (loader.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 10));

    expect(loader).toHaveBeenCalledTimes(1);
    resolveLoader(42);
    await expect(Promise.all([p1, p2])).resolves.toEqual([42, 42]);
  });

  it('loader error still propagates', async () => {
    const service = createService(
      new ThrowingCacheBackend(),
      new ThrowingCacheLoaderLock(),
    );
    const loader = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(service.getOrSet('k', loader, ttl)).rejects.toThrow('db down');
  });

  it('getOrSet resolves when loaderLock.release throws', async () => {
    class ReleasingLock implements CacheLoaderLock {
      async tryAcquire(
        _lockKey: string,
        _ttlMs: number,
      ): Promise<string | null> {
        return 'tok';
      }

      async release(_lockKey: string, _token: string): Promise<void> {
        throw new Error('Redis connection lost on release');
      }
    }

    const service = createService(
      new ThrowingCacheBackend(),
      new ReleasingLock(),
    );
    const loader = jest.fn().mockResolvedValue(99);
    const loadedValue = await service.getOrSet('k', loader, ttl);
    expect(loadedValue).toBe(99);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
