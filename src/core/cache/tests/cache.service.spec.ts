import { CacheService } from '../cache.service';
import { MemoryCacheBackend } from '../backends/memory.backend';
import { DEFAULT_CACHE_KEY_PREFIX } from '../constants/cache.constants';
import { CacheLoaderLock } from '../lock/cache-loader-lock.interface';
import { CacheModuleOptions } from '../types/cache.types';

function createService(
  options: CacheModuleOptions = {},
  loaderLock?: CacheLoaderLock,
): { service: CacheService; backend: MemoryCacheBackend } {
  const backend = new MemoryCacheBackend();
  const service = new CacheService(
    backend,
    {
      keyPrefix: DEFAULT_CACHE_KEY_PREFIX,
      ...options,
    },
    loaderLock,
  );
  return { service, backend };
}

async function expectFreshEventually(
  service: CacheService,
  key: string,
  value: string,
  timeoutMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = await service.get<string>(key);
    if (entry?.status === 'fresh' && entry.value === value) {
      expect(entry).toEqual({ value, status: 'fresh' });
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  await expect(service.get<string>(key)).resolves.toEqual({
    value,
    status: 'fresh',
  });
}

describe('CacheService SWR', () => {
  const ttl = { softTtlMs: 50, hardTtlMs: 200 };

  it('returns fresh value without calling loader again', async () => {
    const { service } = createService();
    const loader = jest.fn(async () => 'a');
    await expect(service.getOrSet('k', loader, ttl)).resolves.toBe('a');
    await expect(service.getOrSet('k', loader, ttl)).resolves.toBe('a');
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(service.get<string>('k')).resolves.toEqual({
      value: 'a',
      status: 'fresh',
    });
  });

  it('serves stale value and revalidates in background', async () => {
    const { service } = createService();
    let n = 0;
    const loader = jest.fn(async () => {
      n += 1;
      return `v${n}`;
    });

    await service.set('k', 'v0', ttl);
    await new Promise((r) => setTimeout(r, ttl.softTtlMs + 10));

    const stale = await service.getOrSet('k', loader, ttl);
    expect(stale).toBe('v0');
    expect(loader).toHaveBeenCalledTimes(1);

    await expectFreshEventually(service, 'k', 'v1');
  });

  it('awaits loader synchronously after hard TTL', async () => {
    const { service } = createService();
    await service.set('k', 'old', { softTtlMs: 10, hardTtlMs: 20 });
    await new Promise((r) => setTimeout(r, 30));

    const loader = jest.fn(async () => 'new');
    await expect(
      service.getOrSet('k', loader, { softTtlMs: 50, hardTtlMs: 100 }),
    ).resolves.toBe('new');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent hard-miss loaders (single-flight)', async () => {
    const { service } = createService();
    let resolveLoader!: (v: string) => void;
    const loader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const p1 = service.getOrSet('k', loader, ttl);
    const p2 = service.getOrSet('k', loader, ttl);
    // Allow both get() awaits to settle and enter loadAndSet.
    await Promise.resolve();
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    resolveLoader('once');
    await expect(Promise.all([p1, p2])).resolves.toEqual(['once', 'once']);
  });

  it('coalesces concurrent stale revalidations', async () => {
    const { service } = createService();
    await service.set('k', 'stale-val', ttl);
    await new Promise((r) => setTimeout(r, ttl.softTtlMs + 10));

    let resolveLoader!: (v: string) => void;
    const loader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const a = await service.getOrSet('k', loader, ttl);
    const b = await service.getOrSet('k', loader, ttl);
    expect(a).toBe('stale-val');
    expect(b).toBe('stale-val');
    expect(loader).toHaveBeenCalledTimes(1);
    resolveLoader('fresh-val');
    await expectFreshEventually(service, 'k', 'fresh-val');
  });

  it('rejects invalid TTL', async () => {
    const { service } = createService();
    await expect(
      service.set('k', 1, { softTtlMs: 100, hardTtlMs: 50 }),
    ).rejects.toThrow(/softTtlMs must be <= hardTtlMs/);
  });

  it('uses module default TTLs when omitted', async () => {
    const { service } = createService({
      defaultSoftTtlMs: 1000,
      defaultHardTtlMs: 2000,
    });
    await service.set('k', 42);
    await expect(service.get<number>('k')).resolves.toEqual({
      value: 42,
      status: 'fresh',
    });
  });

  it('prefixes keys with cache: for backend storage', async () => {
    const { service, backend } = createService();
    await service.set('user:1', { id: 1 }, ttl);
    await expect(backend.get('cache:user:1')).resolves.toMatchObject({
      v: { id: 1 },
    });
    await expect(backend.get('user:1')).resolves.toBeNull();
  });

  it('caches null when cacheNull is enabled (penetration)', async () => {
    const { service } = createService({
      defaultNegativeSoftTtlMs: 500,
      defaultNegativeHardTtlMs: 1000,
    });
    const loader = jest.fn(async () => null as string | null);
    const opts = {
      ttl: { softTtlMs: 5000, hardTtlMs: 10000 },
      cacheNull: true,
    };
    await expect(service.getOrSet('missing', loader, opts)).resolves.toBeNull();
    await expect(service.getOrSet('missing', loader, opts)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(service.get('missing')).resolves.toEqual({
      absent: true,
      status: 'fresh',
    });
  });

  it('applies TTL jitter on set when module ratio > 0', async () => {
    const { service, backend } = createService({ ttlJitterRatio: 0.1 });
    await service.set('k', 1, { softTtlMs: 1000, hardTtlMs: 2000 });
    const entry = await backend.get('cache:k');
    expect(entry).not.toBeNull();
    const span = entry!.hardExpiresAt - entry!.softExpiresAt;
    expect(span).toBeGreaterThanOrEqual(900);
    expect(span).toBeLessThanOrEqual(1200);
  });
});
