import { ConfigService } from '@nestjs/config';

export type HealthResponseMode = 'minimal' | 'detailed';

export function resolveHealthResponseMode(
  configService: Pick<ConfigService, 'get'>,
): HealthResponseMode {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const shouldExposeDependencies =
    configService.get<string>('HEALTH_EXPOSE_DEPENDENCIES') === 'true';
  if (nodeEnv === 'production' && !shouldExposeDependencies) {
    return 'minimal';
  }
  return 'detailed';
}
