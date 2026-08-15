import { MemoryCacheBackend } from './memory.backend';
import { CacheEntry } from '../types/cache.types';

describe('MemoryCacheBackend', () => {
  let backend: MemoryCacheBackend;

  beforeEach(() => {
    backend = new MemoryCacheBackend();
  });

  it('stores and returns an entry while within hard TTL', async () => {
    const now = Date.now();
    const entry: CacheEntry<string> = {
      v: 'hello',
      softExpiresAt: now + 1000,
      hardExpiresAt: now + 5000,
    };
    await backend.set('cache:k', entry, 5000);
    await expect(backend.get<string>('cache:k')).resolves.toEqual(entry);
  });

  it('evicts hard-expired entries on get', async () => {
    const now = Date.now();
    const entry: CacheEntry<number> = {
      v: 1,
      softExpiresAt: now - 2000,
      hardExpiresAt: now - 1000,
    };
    await backend.set('cache:expired', entry, 1);
    await expect(backend.get('cache:expired')).resolves.toBeNull();
    expect(backend.size()).toBe(0);
  });

  it('delete removes the key', async () => {
    const now = Date.now();
    await backend.set(
      'cache:x',
      { v: true, softExpiresAt: now + 1000, hardExpiresAt: now + 2000 },
      2000,
    );
    await backend.delete('cache:x');
    await expect(backend.get('cache:x')).resolves.toBeNull();
  });
});
