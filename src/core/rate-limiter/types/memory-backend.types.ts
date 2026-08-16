/** In-memory token-bucket bucket state. */
export interface TokenBucketState {
  tokens: number;
  lastRefillAt: number;
}

/** In-memory leaky-bucket state. */
export interface LeakyBucketState {
  level: number;
  lastLeakAt: number;
}

/** In-memory fixed-window counter state. */
export interface FixedWindowState {
  windowStart: number;
  count: number;
}

/** One entry in the sliding-window log. */
export interface SlidingLogEntry {
  ts: number;
  cost: number;
}

/** In-memory sliding-window counter state. */
export interface SlidingCounterState {
  windowStart: number;
  previousCount: number;
  currentCount: number;
}

/** In-memory EWMA state. */
export interface EwmaState {
  ewma: number;
  lastAt: number;
}

/** Which memory Map holds a given rate-limit key. */
export type MemoryStoreName =
  | 'tokenBuckets'
  | 'leakyBuckets'
  | 'fixedWindows'
  | 'slidingLogs'
  | 'slidingCounters'
  | 'ewmas';

/** Eviction metadata for a memory-backend key. */
export interface MemoryKeyMeta {
  expiresAt: number;
  lastAccess: number;
  store: MemoryStoreName;
}
