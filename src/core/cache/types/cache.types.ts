import { CacheStorage } from '../enums/cache-storage.enum';

export interface CacheTtl {
  softTtlMs: number;
  hardTtlMs: number;
}

/** Envelope stored in Memory / Redis. */
export interface CacheEntry<T = unknown> {
  v: T;
  softExpiresAt: number;
  hardExpiresAt: number;
}

export type CacheFreshness = 'fresh' | 'stale';

export interface CacheGetResult<T> {
  value: T;
  status: CacheFreshness;
}

export interface CacheModuleOptions {
  storage?: CacheStorage;
  /** Prefixed onto every user key. Default `cache:`. */
  keyPrefix?: string;
  defaultSoftTtlMs?: number;
  defaultHardTtlMs?: number;
}
