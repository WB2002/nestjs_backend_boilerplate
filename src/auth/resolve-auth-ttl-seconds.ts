import type { ConfigService } from '@nestjs/config';

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 900;
export const DEFAULT_SESSION_TTL_SECONDS = 604800;

/**
 * Reads a positive integer TTL in seconds from ConfigService.
 * Coercing string env vars (e.g. "900") to a number is critical because
 * jsonwebtoken interprets numeric strings as milliseconds (900ms) rather than seconds.
 */
export function resolveAuthTtlSeconds(
  configService: Pick<ConfigService, 'get'>,
  envKey: 'ACCESS_TOKEN_TTL' | 'SESSION_TTL',
  defaultSeconds: number,
): number {
  const raw = configService.get<string | number>(envKey);
  if (raw == null || raw === '') {
    return defaultSeconds;
  }
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultSeconds;
  }
  return Math.floor(parsed);
}
