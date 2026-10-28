import { CacheService } from './cache.service';
import { MemoryCacheBackend } from './backends/memory.backend';
import { DEFAULT_CACHE_KEY_PREFIX } from './constants/cache.constants';
import { CacheLoaderLock } from './lock/cache-loader-lock.interface';

class FakeLock implements CacheLoaderLock {
  private holder: string | null = null;

  async tryAcquire(lockKey: string, _ttlMs: number): Promise<string | null> {
    if (this.holder) {
      return null;
    }
    this.holder = lockKey;
    return 'tok';
  }

  async release(lockKey: string, _token: string): Promise<void> {
    if (this.holder === lockKey) {
      this.holder = null;
    }
  }
}

describe('CacheService distributed loader lock', () => {
  const ttl = { softTtlMs: 50, hardTtlMs: 200 };

  it('second caller waits for peer fill instead of duplicate loader', async () => {
    const backend = new MemoryCacheBackend();
    const lock = new FakeLock();
    const service = new CacheService(
      backend,
      { keyPrefix: DEFAULT_CACHE_KEY_PREFIX, loaderWaitMs: 500 },
      lock,
    );

    let resolveLoader!: (v: string) => void;
    const loader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const p1 = service.getOrSet('k', loader, ttl);
    const p2 = service.getOrSet('k', loader, ttl);

    const deadline = Date.now() + 500;
    while (loader.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(loader).toHaveBeenCalledTimes(1);
    resolveLoader('filled');
    await expect(Promise.all([p1, p2])).resolves.toEqual(['filled', 'filled']);
  });
});
