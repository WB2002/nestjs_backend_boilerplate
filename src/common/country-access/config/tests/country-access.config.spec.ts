import {
  parseCountryAccessOptions,
  type CountryAccessEnvInput,
} from '../country-access.config';

describe('parseCountryAccessOptions', () => {
  const baseEnv: CountryAccessEnvInput = {
    GEOIP_DATABASE_PATH: '/data/GeoLite2-Country.mmdb',
  };

  it('applies defaults for refresh interval, unknown policy, and bypass paths', () => {
    const options = parseCountryAccessOptions(baseEnv);
    expect(options.refreshIntervalMs).toBe(60_000);
    expect(options.unknownCountryPolicy).toBe('block');
    expect(options.bypassPaths).toEqual(['/health', '/health/ready']);
    expect(options.geoipDatabasePath).toBe('/data/GeoLite2-Country.mmdb');
    expect(options.persistenceProvider).toBe('postgres');
  });

  it('parses custom refresh interval, policy, and bypass paths', () => {
    const options = parseCountryAccessOptions({
      ...baseEnv,
      COUNTRY_ACCESS_REFRESH_INTERVAL_MS: '120000',
      COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY: 'allow',
      COUNTRY_ACCESS_BYPASS_PATHS: 'healthz,readyz,/metrics',
    });
    expect(options.refreshIntervalMs).toBe(120_000);
    expect(options.unknownCountryPolicy).toBe('allow');
    expect(options.bypassPaths).toEqual(['/healthz', '/readyz', '/metrics']);
  });

  it('requires GEOIP_DATABASE_PATH', () => {
    expect(() => parseCountryAccessOptions({})).toThrow(
      'GEOIP_DATABASE_PATH is required',
    );
  });

  it('rejects invalid unknown-country policy', () => {
    expect(() =>
      parseCountryAccessOptions({
        ...baseEnv,
        COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY: 'maybe',
      }),
    ).toThrow(/COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY/);
  });

  it('rejects non-positive refresh interval', () => {
    expect(() =>
      parseCountryAccessOptions({
        ...baseEnv,
        COUNTRY_ACCESS_REFRESH_INTERVAL_MS: '0',
      }),
    ).toThrow(/Invalid positive integer/);
  });

  it('parses COUNTRY_ACCESS_PERSISTENCE_PROVIDER override and rejects invalid values', () => {
    const mongoOptions = parseCountryAccessOptions({
      ...baseEnv,
      COUNTRY_ACCESS_PERSISTENCE_PROVIDER: 'mongodb',
    });
    expect(mongoOptions.persistenceProvider).toBe('mongodb');

    expect(() =>
      parseCountryAccessOptions({
        ...baseEnv,
        COUNTRY_ACCESS_PERSISTENCE_PROVIDER: 'sqlite',
      }),
    ).toThrow(/COUNTRY_ACCESS_PERSISTENCE_PROVIDER/);
  });
});
