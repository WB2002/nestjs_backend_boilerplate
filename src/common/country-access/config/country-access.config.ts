import type {
  CountryAccessPersistenceProvider,
  UnknownCountryPolicy,
} from '../domain';
import {
  DEFAULT_COUNTRY_ACCESS_BYPASS_PATHS,
  DEFAULT_COUNTRY_ACCESS_REFRESH_INTERVAL_MS,
  DEFAULT_COUNTRY_ACCESS_UNKNOWN_POLICY,
} from '../constants';

export interface CountryAccessModuleOptions {
  refreshIntervalMs: number;
  geoipDatabasePath: string;
  unknownCountryPolicy: UnknownCountryPolicy;
  bypassPaths: string[];
  persistenceProvider: CountryAccessPersistenceProvider;
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

export interface CountryAccessEnvInput {
  COUNTRY_ACCESS_REFRESH_INTERVAL_MS?: string | undefined;
  GEOIP_DATABASE_PATH?: string | undefined;
  COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY?: string | undefined;
  COUNTRY_ACCESS_BYPASS_PATHS?: string | undefined;
  POSTGRES_HOST?: string | undefined;
  POSTGRES_PORT?: string | undefined;
  POSTGRES_USER?: string | undefined;
  POSTGRES_PASSWORD?: string | undefined;
  POSTGRES_DB?: string | undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer configuration value: ${raw}`);
  }
  return parsed;
}

function parseUnknownPolicy(raw: string | undefined): UnknownCountryPolicy {
  const value = (raw ?? DEFAULT_COUNTRY_ACCESS_UNKNOWN_POLICY)
    .trim()
    .toLowerCase();
  if (value === 'block' || value === 'allow') {
    return value;
  }
  throw new Error(
    `Invalid COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY: ${raw}. Expected "block" or "allow".`,
  );
}

function parseBypassPaths(raw: string | undefined): string[] {
  if (raw == null || raw.trim() === '') {
    return [...DEFAULT_COUNTRY_ACCESS_BYPASS_PATHS];
  }
  return raw
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map((path) => (path.startsWith('/') ? path : `/${path}`));
}

export function parseCountryAccessOptions(
  env: CountryAccessEnvInput,
  persistenceProvider: CountryAccessPersistenceProvider = 'postgres',
): CountryAccessModuleOptions {
  const geoipDatabasePath = env.GEOIP_DATABASE_PATH?.trim();
  if (!geoipDatabasePath) {
    throw new Error('GEOIP_DATABASE_PATH is required');
  }

  return {
    refreshIntervalMs: parsePositiveInt(
      env.COUNTRY_ACCESS_REFRESH_INTERVAL_MS,
      DEFAULT_COUNTRY_ACCESS_REFRESH_INTERVAL_MS,
    ),
    geoipDatabasePath,
    unknownCountryPolicy: parseUnknownPolicy(
      env.COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY,
    ),
    bypassPaths: parseBypassPaths(env.COUNTRY_ACCESS_BYPASS_PATHS),
    persistenceProvider,
    postgres: {
      host: env.POSTGRES_HOST?.trim() || 'localhost',
      port: parsePositiveInt(env.POSTGRES_PORT, 5432),
      user: env.POSTGRES_USER?.trim() || 'user',
      password: env.POSTGRES_PASSWORD ?? 'password',
      database: env.POSTGRES_DB?.trim() || 'nestjs_db',
    },
  };
}
