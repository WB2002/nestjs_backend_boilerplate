export const COUNTRY_ACCESS_REPOSITORY = Symbol('COUNTRY_ACCESS_REPOSITORY');
export const GEO_LOCATION_SERVICE = Symbol('GEO_LOCATION_SERVICE');
export const COUNTRY_ACCESS_OPTIONS = Symbol('COUNTRY_ACCESS_OPTIONS');
export const POSTGRES_POOL = Symbol('POSTGRES_POOL');
export const SKIP_COUNTRY_ACCESS_KEY = 'skipCountryAccess';

export const DEFAULT_COUNTRY_ACCESS_REFRESH_INTERVAL_MS = 60_000;
export const DEFAULT_COUNTRY_ACCESS_UNKNOWN_POLICY = 'block' as const;
export const DEFAULT_COUNTRY_ACCESS_BYPASS_PATHS = [
  '/health',
  '/health/ready',
] as const;

export const ISO_3166_1_ALPHA2_PATTERN = /^[A-Z]{2}$/;
