import { MaxMindGeoLocationService } from '../maxmind-geo-location.service';
import type { CountryAccessModuleOptions } from '../../config/country-access.config';
import { CountryAccessTelemetry } from '../../telemetry/country-access.telemetry';

describe('MaxMindGeoLocationService', () => {
  const options: CountryAccessModuleOptions = {
    refreshIntervalMs: 60_000,
    geoipDatabasePath: 'test/fixtures/geoip/placeholder.mmdb',
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

  let telemetry: jest.Mocked<CountryAccessTelemetry>;
  let get: jest.Mock;

  beforeEach(() => {
    telemetry = {
      emit: jest.fn(),
      accessDenied: jest.fn(),
      invalidIp: jest.fn(),
      unknownCountry: jest.fn(),
      geoIpFailure: jest.fn(),
      inactiveBypass: jest.fn(),
      refreshSuccess: jest.fn(),
      refreshFailure: jest.fn(),
    } as unknown as jest.Mocked<CountryAccessTelemetry>;
    get = jest.fn();
  });

  function createService() {
    return new MaxMindGeoLocationService(options, telemetry, { get });
  }

  it('returns ISO country code for IPv4', () => {
    get.mockReturnValue({ country: { iso_code: 'us' } });
    const service = createService();
    expect(service.getCountryCode('8.8.8.8')).toBe('US');
  });

  it('returns ISO country code for IPv6', () => {
    get.mockReturnValue({ country: { iso_code: 'GB' } });
    const service = createService();
    expect(service.getCountryCode('2001:4860:4860::8888')).toBe('GB');
  });

  it('returns null for malformed IP', () => {
    const service = createService();
    expect(service.getCountryCode('not-an-ip')).toBeNull();
    expect(telemetry.invalidIp).toHaveBeenCalled();
  });

  it('returns null for private IP', () => {
    const service = createService();
    expect(service.getCountryCode('192.168.1.1')).toBeNull();
    expect(telemetry.unknownCountry).toHaveBeenCalledWith(
      'private_or_reserved_ip',
    );
  });

  it('returns null for unknown IP with no record', () => {
    get.mockReturnValue(null);
    const service = createService();
    expect(service.getCountryCode('1.1.1.1')).toBeNull();
    expect(telemetry.unknownCountry).toHaveBeenCalledWith(
      'missing_geoip_record',
    );
  });

  it('returns null when reader throws', () => {
    get.mockImplementation(() => {
      throw new Error('corrupt db');
    });
    const service = createService();
    expect(service.getCountryCode('1.1.1.1')).toBeNull();
    expect(telemetry.geoIpFailure).toHaveBeenCalled();
  });
});
