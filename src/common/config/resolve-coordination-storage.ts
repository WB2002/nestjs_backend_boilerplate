import { CacheStorage } from '../../core/cache/enums/cache-storage.enum';
import { RateLimitStorage } from '../../core/rate-limiter/enums/rate-limit-storage.enum';

type StorageToken = 'memory' | 'redis';

function parseStorageToken(
  raw: string | undefined,
  label: string,
): StorageToken | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'memory':
      return 'memory';
    case 'redis':
      return 'redis';
    default:
      throw new Error(`${label} must be "memory" or "redis" (got "${raw}")`);
  }
}

function defaultStorageForNodeEnv(nodeEnv: string | undefined): StorageToken {
  return nodeEnv === 'production' ? 'redis' : 'memory';
}

export function resolveRateLimitStorage(config: {
  nodeEnv?: string;
  rateLimitStorage?: string;
}): RateLimitStorage {
  const token =
    parseStorageToken(config.rateLimitStorage, 'RATE_LIMIT_STORAGE') ??
    defaultStorageForNodeEnv(config.nodeEnv);
  return token === 'redis' ? RateLimitStorage.Redis : RateLimitStorage.Memory;
}

export function resolveCacheStorage(config: {
  nodeEnv?: string;
  cacheStorage?: string;
}): CacheStorage {
  const token =
    parseStorageToken(config.cacheStorage, 'CACHE_STORAGE') ??
    defaultStorageForNodeEnv(config.nodeEnv);
  return token === 'redis' ? CacheStorage.Redis : CacheStorage.Memory;
}
