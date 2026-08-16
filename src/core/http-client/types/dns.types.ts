export interface DnsCacheOptions {
  ttlMs?: number;
  family?: 0 | 4 | 6;
  hints?: number;
}

export interface CacheEntry {
  address: string;
  family: number;
  expiresAt: number;
}

export type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;
