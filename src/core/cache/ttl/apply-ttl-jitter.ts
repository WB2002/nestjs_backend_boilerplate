import { CacheTtl } from '../types/cache.types';

export function applyTtlJitter(
  base: CacheTtl,
  ratio: number,
  random: () => number = Math.random,
): CacheTtl {
  if (ratio <= 0) {
    return base;
  }
  const softJitter = Math.floor(random() * ratio * base.softTtlMs);
  const hardJitter = Math.floor(random() * ratio * base.hardTtlMs);
  const softTtlMs = base.softTtlMs + softJitter;
  const hardTtlMs = base.hardTtlMs + hardJitter;
  if (softTtlMs <= 0 || hardTtlMs <= 0) {
    throw new Error('Cache TTL values must be > 0 after jitter');
  }
  if (softTtlMs > hardTtlMs) {
    throw new Error('softTtlMs must be <= hardTtlMs');
  }
  return { softTtlMs, hardTtlMs };
}
