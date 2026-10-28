export interface CacheLoaderLock {
  tryAcquire(lockKey: string, ttlMs: number): Promise<string | null>;
  release(lockKey: string, token: string): Promise<void>;
}
