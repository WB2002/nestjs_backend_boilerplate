import { CookieSerializeOptions } from '@fastify/cookie';
import { RateLimitAlgorithm } from '../enums/rate-limit-algorithm.enum';
import { RateLimitIdentifier } from '../enums/rate-limit-identifier.enum';
import { RateLimitStorage } from '../enums/rate-limit-storage.enum';

export interface RateLimitMethodConfig {
  /** Policy name for metrics/logs/tracing (e.g. "login-ip"). */
  name?: string;
  /** Alias of `name`. */
  policy?: string;
  identifier: RateLimitIdentifier;
  /**
   * Window length in **milliseconds** (e.g. `60_000` = 1 minute).
   * Mapped to `ConsumeContext.durationMs` at consume time.
   */
  duration: number;
  /**
   * Max cost units allowed per `duration` window.
   * Not strictly “requests” when `cost` is greater than 1.
   */
  limit: number;
  /** Units consumed per allowed hit. Default `1`. */
  cost?: number;
  /**
   * TokenBucket / LeakyBucket capacity.
   * Defaults to `limit` when omitted.
   */
  burst?: number;
  algorithm?: RateLimitAlgorithm;
  /**
   * `'global'` — one bucket for the whole app (`app` scope).
   * `'route'` (default) — per matched route; unmatched routes share `app:unmatched`.
   */
  keyScope?: 'route' | 'global';
}

export interface RateLimitDecoratorOptions {
  algorithm?: RateLimitAlgorithm;
  /** Policy list (identifier + limit + duration, etc.). */
  methods: RateLimitMethodConfig[];
}

export interface GuestCookieOptions {
  name?: string;
  /**
   * Cookie lifetime in **seconds** (Fastify / Set-Cookie `Max-Age` convention).
   * Not milliseconds — unlike rate-limit `duration`.
   */
  maxAge?: number;
  sameSite?: CookieSerializeOptions['sameSite'];
  secure?: boolean;
  httpOnly?: boolean;
  path?: string;
}

export interface ConsumeContext {
  algorithm: RateLimitAlgorithm;
  key: string;
  /** Max cost units for this consume (same meaning as config `limit`). */
  limit: number;
  /** Window length in **milliseconds**. */
  durationMs: number;
  /** Units to spend for this hit. */
  cost: number;
  /** Reference clock for this request in **milliseconds** since Unix epoch. */
  nowMs: number;
  /** TokenBucket / LeakyBucket capacity; defaults to `limit`. */
  burst?: number;
  policy?: string;
}

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  /**
   * Relative time until budget reset / full refill, in **milliseconds**.
   * The guard converts this to a Unix-epoch `X-RateLimit-Reset` header.
   */
  resetMs: number;
  /**
   * Relative time until the caller may retry, in **milliseconds**.
   * Used for the `Retry-After` header (as seconds).
   * May differ from `resetMs` for TokenBucket / LeakyBucket.
   */
  retryAfterMs: number;
}

export type OnDecisionHook = (
  context: ConsumeContext,
  result: ConsumeResult,
) => void | Promise<void>;

export interface RateLimiterModuleOptions {
  storage?: RateLimitStorage;
  algorithm?: RateLimitAlgorithm;
  methods?: RateLimitMethodConfig[];
  guestCookie?: GuestCookieOptions;
  fingerprintHeader?: string;
  /** Hash route scope in Redis keys to keep them short. Default true for Redis. */
  hashRouteScope?: boolean;
  onDecision?: OnDecisionHook;
}
