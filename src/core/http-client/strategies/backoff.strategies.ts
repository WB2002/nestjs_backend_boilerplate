import type { BackoffStrategy } from '../types';

export interface FixedBackoffOptions {
  delay: number;
}

export function fixedBackoff(options: FixedBackoffOptions): BackoffStrategy {
  const delay = Math.max(0, options.delay);
  return {
    name: 'fixed',
    delayMs(): number {
      return delay;
    },
  };
}

export interface LinearBackoffOptions {
  baseDelay: number;
  maxDelay?: number;
}

export function linearBackoff(options: LinearBackoffOptions): BackoffStrategy {
  const baseDelay = Math.max(0, options.baseDelay);
  const maxDelay = options.maxDelay ?? Number.POSITIVE_INFINITY;
  return {
    name: 'linear',
    delayMs(attempt: number): number {
      const n = Math.max(1, attempt);
      return Math.min(baseDelay * n, maxDelay);
    },
  };
}

export interface ExponentialBackoffOptions {
  baseDelay: number;
  maxDelay?: number;
  factor?: number;
}

export function exponentialBackoff(
  options: ExponentialBackoffOptions,
): BackoffStrategy {
  const baseDelay = Math.max(0, options.baseDelay);
  const maxDelay = options.maxDelay ?? Number.POSITIVE_INFINITY;
  const factor = options.factor ?? 2;
  return {
    name: 'exponential',
    delayMs(attempt: number): number {
      const n = Math.max(1, attempt);
      const delay = baseDelay * Math.pow(factor, n - 1);
      return Math.min(delay, maxDelay);
    },
  };
}
