import { ConfigService } from '@nestjs/config';
import { RateLimitIdentifier } from '@/core/rate-limiter/enums/rate-limit-identifier.enum';
import type { RateLimitMethodConfig } from '@/core/rate-limiter/types/rate-limit.types';

const DEFAULT_DEV_GLOBAL_IP_LIMIT = 600;
const DEFAULT_PROD_GLOBAL_IP_LIMIT = 10;

/**
 * Global IP rate-limit policy tuned by environment so local/dev is usable behind NAT.
 */
export function resolveDefaultRateLimitMethods(
  configService: ConfigService,
): RateLimitMethodConfig[] {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const configuredLimit = configService.get<number>(
    'RATE_LIMIT_GLOBAL_IP_LIMIT',
  );
  const limit =
    configuredLimit ??
    (nodeEnv === 'production'
      ? DEFAULT_PROD_GLOBAL_IP_LIMIT
      : DEFAULT_DEV_GLOBAL_IP_LIMIT);

  return [
    {
      name: 'global-ip',
      identifier: RateLimitIdentifier.Ip,
      duration: 60_000,
      limit,
      cost: 1,
      keyScope: 'global',
    },
  ];
}
