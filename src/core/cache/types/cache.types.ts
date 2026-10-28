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
  absent?: boolean;
}

export type CacheFreshness = 'fresh' | 'stale';

export type CacheGetResult<T> =
  | { value: T; status: CacheFreshness }
  | { absent: true; status: CacheFreshness };

export interface CacheGetOrSetOptions {
  ttl?: CacheTtl;
  /** When true, persist loader `null` as a negative entry. */
  cacheNull?: boolean;
  negativeTtl?: CacheTtl;
}

export interface CacheModuleOptions {
  storage?: CacheStorage;
  /** Prefixed onto every user key. Default `cache:`. */
  keyPrefix?: string;
  defaultSoftTtlMs?: number;
  defaultHardTtlMs?: number;
  /** 0–1 fraction; 0 disables jitter. */
  ttlJitterRatio?: number;
  loaderLockTtlMs?: number;
  loaderWaitMs?: number;
  defaultNegativeSoftTtlMs?: number;
  defaultNegativeHardTtlMs?: number;
}
