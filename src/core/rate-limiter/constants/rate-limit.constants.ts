import { RateLimitAlgorithm } from '../enums/rate-limit-algorithm.enum';
import { RateLimitIdentifier } from '../enums/rate-limit-identifier.enum';
import { RateLimitStorage } from '../enums/rate-limit-storage.enum';
import { RateLimiterModuleOptions } from '../types/rate-limit.types';

export const RATE_LIMIT_OPTIONS = 'RATE_LIMIT_OPTIONS';
export const RATE_LIMIT_BACKEND = 'RATE_LIMIT_BACKEND';

export const RATE_LIMIT_KEY = 'rateLimit';
export const RATE_LIMIT_COST_KEY = 'rateLimitCost';
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

export const DEFAULT_GUEST_COOKIE_NAME = 'guest_id';
export const DEFAULT_GUEST_COOKIE_MAX_AGE = 31_536_000;
export const DEFAULT_FINGERPRINT_HEADER = 'x-device-fingerprint';

/** UUID v4 pattern for guest_id cookie values. */
export const GUEST_ID_UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Max distinct keys retained by the in-memory backend. */
export const MEMORY_BACKEND_MAX_KEYS = 50_000;

/** Memory key TTL = durationMs * this multiplier (mirrors Redis PEXPIRE duration * 2). */
export const MEMORY_KEY_TTL_MULTIPLIER = 2;

/** Fraction of max keys to drop when the memory backend hits the cap (LRU). */
export const MEMORY_EVICT_RATIO = 0.1;

/** Default module options when `forRoot` / `forRootAsync` omit fields. */
export const DEFAULT_RATE_LIMITER_OPTIONS: RateLimiterModuleOptions = {
  storage: RateLimitStorage.Memory,
  algorithm: RateLimitAlgorithm.FixedWindowCounter,
  methods: [
    {
      name: 'global-ip',
      identifier: RateLimitIdentifier.Ip,
      duration: 60_000,
      limit: 10,
      cost: 1,
      keyScope: 'global',
    },
  ],
};
