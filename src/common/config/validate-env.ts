import { envSchema } from './env.schema';

function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return true;
  }
  return false;
}

/**
 * Nest ConfigModule `validate` hook.
 * Throws listing every missing/empty required key (not first-failure-only).
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing: string[] = [];

  for (const [key, field] of Object.entries(envSchema)) {
    if (!field.required) {
      continue;
    }
    const configValue = Object.entries(config).find(
      ([envKey]) => envKey === key,
    )?.[1];
    if (isMissing(configValue)) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  if (
    config.NODE_ENV === 'production' &&
    config.CONFORMANCE_HARNESS_ENABLED === 'true'
  ) {
    throw new Error(
      'CONFORMANCE_HARNESS_ENABLED cannot be true when NODE_ENV=production',
    );
  }

  if (config.NODE_ENV === 'production') {
    const raw = config.ALLOWED_ORIGINS;
    const origins =
      typeof raw === 'string'
        ? raw
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : [];
    if (origins.length === 0) {
      throw new Error('ALLOWED_ORIGINS is required when NODE_ENV=production');
    }
  }

  if (config.CONFORMANCE_HARNESS_ENABLED === 'true') {
    const token = config.CONFORMANCE_HARNESS_TOKEN;
    if (isMissing(token)) {
      throw new Error(
        'CONFORMANCE_HARNESS_TOKEN is required when CONFORMANCE_HARNESS_ENABLED=true',
      );
    }
    if (
      config.HTTP_CLIENT_ALLOW_PRIVATE_URLS === 'true' &&
      config.NODE_ENV !== 'test'
    ) {
      throw new Error(
        'HTTP_CLIENT_ALLOW_PRIVATE_URLS cannot be true when CONFORMANCE_HARNESS_ENABLED=true outside NODE_ENV=test',
      );
    }
  }

  return config;
}
