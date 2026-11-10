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

  return config;
}
