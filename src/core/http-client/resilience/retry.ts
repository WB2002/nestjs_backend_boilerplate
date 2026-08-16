import type { HttpRequest, RetryPolicy } from '../types';
import {
  HttpError,
  NetworkError,
  RetryExhaustedError,
  TimeoutError,
  normalizeError,
} from '../errors';

const SAFE_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
  'OPTIONS',
]);

export function defaultCanRetry(request: HttpRequest): boolean {
  return SAFE_METHODS.has(request.method);
}

export function isRetryEligible(
  request: HttpRequest,
  policy: RetryPolicy,
  hasIdempotencyKey: boolean,
): boolean {
  if (policy.canRetry) {
    return policy.canRetry(request);
  }
  return defaultCanRetry(request) || hasIdempotencyKey;
}

export function defaultIsTransient(error: unknown): boolean {
  const normalized = normalizeError(error);
  if (normalized instanceof RetryExhaustedError) {
    return defaultIsTransient(normalized.cause);
  }
  if (
    normalized instanceof TimeoutError ||
    normalized instanceof NetworkError
  ) {
    return true;
  }
  if (normalized instanceof HttpError) {
    return [408, 425, 429, 500, 502, 503, 504].includes(normalized.status);
  }
  return false;
}

/**
 * Whether a logical failure should trip the circuit breaker.
 * Unwraps one level of RetryExhaustedError so exhausted transient retries count.
 */
export function isBreakerFailure(
  error: unknown,
  isTransient: (error: unknown) => boolean = defaultIsTransient,
): boolean {
  if (isTransient(error)) {
    return true;
  }
  const normalized = normalizeError(error);
  if (normalized instanceof RetryExhaustedError && normalized.cause != null) {
    return isTransient(normalized.cause);
  }
  return false;
}

export function computeBackoffDelayMs(
  policy: RetryPolicy,
  attempt: number,
): number {
  const base = policy.backoff.delayMs(attempt);
  if (!policy.jitter) {
    return Math.max(0, base);
  }
  return Math.max(0, policy.jitter.apply(base, attempt));
}
