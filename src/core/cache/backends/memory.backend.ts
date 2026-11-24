import { CacheBackend } from '../types/cache-backend.interface';
import { CacheEntry } from '../types/cache.types';

const DEFAULT_MEMORY_CACHE_MAX_KEYS = 10_000;
const MEMORY_CACHE_SWEEP_INTERVAL_MS = 30_000;

export class MemoryCacheBackend implements CacheBackend {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxKeys: number;
  private readonly sweeper: NodeJS.Timeout;

  constructor(maxKeys = DEFAULT_MEMORY_CACHE_MAX_KEYS) {
    this.maxKeys = Math.max(1, maxKeys);
    this.sweeper = setInterval(
      () => this.sweepExpired(Date.now()),
      MEMORY_CACHE_SWEEP_INTERVAL_MS,
    );
    if (typeof this.sweeper.unref === 'function') {
      this.sweeper.unref();
    }
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.hardExpiresAt) {
      this.store.delete(key);
      return null;
    }
    // Refresh LRU order on read.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry as CacheEntry<T>;
  }

  async set<T>(
    key: string,
    entry: CacheEntry<T>,
    _hardTtlMs: number,
  ): Promise<void> {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxKeys) {
      this.sweepExpired(Date.now());
      while (this.store.size >= this.maxKeys) {
        const oldestKey = this.store.keys().next();
        if (oldestKey.done) {
          break;
        }
        this.store.delete(oldestKey.value);
      }
    }
    this.store.set(key, entry as CacheEntry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  dispose(): void {
    clearInterval(this.sweeper);
  }

  async quit(): Promise<void> {
    this.dispose();
  }

  /** Test helper: number of live keys (including soft-stale). */
  size(): number {
    return this.store.size;
  }

  private sweepExpired(nowMs: number): void {
    for (const [key, entry] of this.store) {
      if (nowMs >= entry.hardExpiresAt) {
        this.store.delete(key);
      }
    }
  }
}
