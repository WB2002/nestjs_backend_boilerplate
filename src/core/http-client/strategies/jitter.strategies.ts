import type { JitterStrategy } from '../types';

export type RandomFn = () => number;

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function fullJitter(random: RandomFn = Math.random): JitterStrategy {
  return {
    name: 'full',
    apply(delayMs: number): number {
      return Math.floor(clamp01(random()) * Math.max(0, delayMs));
    },
  };
}

export function equalJitter(random: RandomFn = Math.random): JitterStrategy {
  return {
    name: 'equal',
    apply(delayMs: number): number {
      const base = Math.max(0, delayMs) / 2;
      return Math.floor(base + clamp01(random()) * base);
    },
  };
}

export function decorrelatedJitter(
  options: { baseDelay?: number; maxDelay?: number; random?: RandomFn } = {},
): JitterStrategy {
  const baseDelay = options.baseDelay ?? 100;
  const maxDelay = options.maxDelay ?? Number.POSITIVE_INFINITY;
  const random = options.random ?? Math.random;
  let previous = baseDelay;

  return {
    name: 'decorrelated',
    apply(delayMs: number): number {
      const next = Math.min(
        maxDelay,
        Math.floor(baseDelay + clamp01(random()) * previous * 3),
      );
      previous = Math.max(next, Math.min(delayMs, maxDelay));
      return Math.min(next, maxDelay);
    },
  };
}
