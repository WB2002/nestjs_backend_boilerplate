import type { ConfigService } from '@nestjs/config';
import type { CacheModuleOptions } from '../../core/cache/types/cache.types';

function parseRatio(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('CACHE_TTL_JITTER_RATIO must be a number between 0 and 1');
  }
  return value;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid cache config integer: "${raw}"`);
  }
  return value;
}

export function parseCacheModuleOptions(
  configService: ConfigService,
): Partial<CacheModuleOptions> {
  const ttlJitterRatio = parseRatio(
    configService.get<string>('CACHE_TTL_JITTER_RATIO'),
  );
  const loaderLockTtlMs = parsePositiveInt(
    configService.get<string>('CACHE_LOADER_LOCK_TTL_MS'),
  );
  const loaderWaitMs = parsePositiveInt(
    configService.get<string>('CACHE_LOADER_WAIT_MS'),
  );
  const defaultNegativeSoftTtlMs = parsePositiveInt(
    configService.get<string>('CACHE_NEGATIVE_SOFT_TTL_MS'),
  );
  const defaultNegativeHardTtlMs = parsePositiveInt(
    configService.get<string>('CACHE_NEGATIVE_HARD_TTL_MS'),
  );

  return {
    ...(ttlJitterRatio !== undefined ? { ttlJitterRatio } : {}),
    ...(loaderLockTtlMs !== undefined ? { loaderLockTtlMs } : {}),
    ...(loaderWaitMs !== undefined ? { loaderWaitMs } : {}),
    ...(defaultNegativeSoftTtlMs !== undefined
      ? { defaultNegativeSoftTtlMs }
      : {}),
    ...(defaultNegativeHardTtlMs !== undefined
      ? { defaultNegativeHardTtlMs }
      : {}),
  };
}
