import { CacheEntry } from './cache.types';

export interface CacheBackend {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  /**
   * Persist an envelope. `hardTtlMs` is the Redis PEXPIRE / memory eviction horizon
   * from now (must match entry.hardExpiresAt - now at write time).
   */
  set<T>(key: string, entry: CacheEntry<T>, hardTtlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  quit?(): Promise<void>;
}
