import { ConfigService } from '@nestjs/config';

export type CorsOriginsResolveResult =
  | { mode: 'allow-all' }
  | { mode: 'list'; origins: string[] };

export function resolveCorsOrigins(
  configService: Pick<ConfigService, 'get'>,
): CorsOriginsResolveResult {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const raw = configService.get<string>('ALLOWED_ORIGINS');
  const origins =
    raw
      ?.split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0) ?? [];

  if (nodeEnv === 'production') {
    return { mode: 'list', origins };
  }

  if (origins.length === 0) {
    return { mode: 'allow-all' };
  }

  return { mode: 'list', origins };
}

export function assertProductionAllowedOrigins(
  nodeEnv: string,
  origins: string[],
): void {
  if (nodeEnv !== 'production') {
    return;
  }
  if (origins.length === 0) {
    throw new Error('ALLOWED_ORIGINS is required when NODE_ENV=production');
  }
}

export function toFastifyCorsOrigin(
  resolveResult: CorsOriginsResolveResult,
): true | string[] {
  if (resolveResult.mode === 'allow-all') {
    return true;
  }
  return [...resolveResult.origins];
}
