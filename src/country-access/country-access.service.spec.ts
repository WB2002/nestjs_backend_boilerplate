import { CountryAccessService } from './country-access.service';
import type { CountryAccessModuleOptions } from './config/country-access.config';
import type { CountryAccessConfig, CountryAccessRepository } from './domain';
import { CountryAccessTelemetry } from './telemetry/country-access.telemetry';

function createConfig(
  countryCode: string,
  enabled: boolean,
): CountryAccessConfig {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return { countryCode, enabled, createdAt: now, updatedAt: now };
}

describe('CountryAccessService', () => {
  let repository: jest.Mocked<CountryAccessRepository>;
  let telemetry: jest.Mocked<CountryAccessTelemetry>;
  let options: CountryAccessModuleOptions;
  let service: CountryAccessService;

  beforeEach(() => {
    jest.useFakeTimers();
    repository = {
      getAll: jest.fn(),
      getByCountryCode: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    };
    telemetry = {
      emit: jest.fn().mockResolvedValue(undefined),
      accessDenied: jest.fn().mockResolvedValue(undefined),
      invalidIp: jest.fn().mockResolvedValue(undefined),
      unknownCountry: jest.fn().mockResolvedValue(undefined),
      geoIpFailure: jest.fn().mockResolvedValue(undefined),
      inactiveBypass: jest.fn().mockResolvedValue(undefined),
      refreshSuccess: jest.fn().mockResolvedValue(undefined),
      refreshFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CountryAccessTelemetry>;
    options = {
      refreshIntervalMs: 60_000,
      geoipDatabasePath: '/tmp/GeoLite2-Country.mmdb',
      unknownCountryPolicy: 'block',
      bypassPaths: ['/health'],
      persistenceProvider: 'postgres',
      postgres: {
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'password',
        database: 'nestjs_db',
      },
    };
    service = new CountryAccessService(repository, options, telemetry);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('starts inactive and allows all countries until first successful refresh', async () => {
    repository.getAll.mockRejectedValue(new Error('db down'));
    await service.onApplicationBootstrap();
    expect(service.getStatus()).toBe('inactive');
    expect(service.isCountryAllowed('US')).toBe(true);
    expect(telemetry.refreshFailure).toHaveBeenCalled();
  });

  it('allows enabled countries and blocks disabled ones after activation', async () => {
    repository.getAll.mockResolvedValue([
      createConfig('US', true),
      createConfig('PK', false),
    ]);
    await service.onApplicationBootstrap();
    expect(service.getStatus()).toBe('active');
    expect(service.isCountryAllowed('US')).toBe(true);
    expect(service.isCountryAllowed('PK')).toBe(false);
    expect(service.isCountryAllowed('GB')).toBe(false);
  });

  it('blocks unknown country codes when policy is block', async () => {
    repository.getAll.mockResolvedValue([createConfig('US', true)]);
    await service.onApplicationBootstrap();
    expect(service.isCountryAllowed('ZZ')).toBe(false);
    expect(service.isCountryAllowed('invalid')).toBe(false);
  });

  it('applies unknown-country policy only to invalid codes; valid codes use the snapshot', async () => {
    options.unknownCountryPolicy = 'allow';
    service = new CountryAccessService(repository, options, telemetry);
    repository.getAll.mockResolvedValue([createConfig('US', true)]);
    await service.onApplicationBootstrap();
    expect(service.isCountryAllowed('ZZ')).toBe(false);
    expect(service.isCountryAllowed('invalid')).toBe(true);
  });

  it('atomically replaces the snapshot on successful refresh', async () => {
    repository.getAll
      .mockResolvedValueOnce([createConfig('US', true)])
      .mockResolvedValueOnce([
        createConfig('US', true),
        createConfig('GB', true),
      ]);
    await service.onApplicationBootstrap();
    const first = service.getAllowedCountries();
    expect([...first]).toEqual(['US']);

    await service.refreshSnapshot();
    const second = service.getAllowedCountries();
    expect([...second].sort()).toEqual(['GB', 'US']);
    expect(first.has('GB')).toBe(false);
    expect(service.getSnapshotVersion()).toBe(2);
  });

  it('retains the previous snapshot when refresh fails', async () => {
    repository.getAll
      .mockResolvedValueOnce([createConfig('US', true)])
      .mockRejectedValueOnce(new Error('timeout'));
    await service.onApplicationBootstrap();
    await service.refreshSnapshot();
    expect(service.isCountryAllowed('US')).toBe(true);
    expect(service.getStatus()).toBe('active');
    expect(service.getSnapshotVersion()).toBe(1);
    expect(telemetry.refreshFailure).toHaveBeenCalled();
  });

  it('exposes a readonly snapshot that concurrent readers can hold', async () => {
    repository.getAll
      .mockResolvedValueOnce([createConfig('US', true)])
      .mockResolvedValueOnce([createConfig('CA', true)]);
    await service.onApplicationBootstrap();
    const seen = service.getAllowedCountries();
    await service.refreshSnapshot();
    expect([...seen]).toEqual(['US']);
    expect([...service.getAllowedCountries()]).toEqual(['CA']);
  });

  it('clears the refresh timer on destroy', async () => {
    repository.getAll.mockResolvedValue([]);
    await service.onApplicationBootstrap();
    const clearSpy = jest.spyOn(global, 'clearInterval');
    service.onModuleDestroy();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
