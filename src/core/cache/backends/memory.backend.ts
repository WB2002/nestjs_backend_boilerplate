import { CacheBackend } from '../types/cache-backend.interface';
import { CacheEntry } from '../types/cache.types';

export class MemoryCacheBackend implements CacheBackend {
  private readonly store = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.hardExpiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry as CacheEntry<T>;
  }

  async set<T>(
    key: string,
    entry: CacheEntry<T>,
    _hardTtlMs: number,
  ): Promise<void> {
    this.store.set(key, entry as CacheEntry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Test helper: number of live keys (including soft-stale). */
  size(): number {
    return this.store.size;
  }
}
