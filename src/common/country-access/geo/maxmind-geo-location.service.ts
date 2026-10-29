import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import maxmind, {
  type CountryResponse,
  type Reader,
  validate as validateIp,
} from 'maxmind';
import { isPrivateOrReservedAddress } from '@/common/sanitization/utils/ssrf.utils';
import { COUNTRY_ACCESS_OPTIONS } from '../constants';
import type { CountryAccessModuleOptions } from '../config/country-access.config';
import { normalizeCountryCode, type GeoLocationService } from '../domain';
import { CountryAccessTelemetry } from '../telemetry/country-access.telemetry';

export type CountryReader = Pick<Reader<CountryResponse>, 'get'>;

export const MAXMIND_READER = Symbol('MAXMIND_READER');

@Injectable()
export class MaxMindGeoLocationService
  implements GeoLocationService, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MaxMindGeoLocationService.name);
  private reader: CountryReader | null = null;

  constructor(
    @Inject(COUNTRY_ACCESS_OPTIONS)
    private readonly options: CountryAccessModuleOptions,
    private readonly telemetry: CountryAccessTelemetry,
    @Optional()
    @Inject(MAXMIND_READER)
    optionalReader?: CountryReader | null,
  ) {
    if (optionalReader) {
      this.reader = optionalReader;
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.reader) {
      return;
    }
    try {
      this.reader = await maxmind.open<CountryResponse>(
        this.options.geoipDatabasePath,
      );
      this.logger.log(
        `Loaded GeoIP database from ${this.options.geoipDatabasePath}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to open GeoIP database: ${message}`);
      throw err;
    }
  }

  onModuleDestroy(): void {
    this.reader = null;
  }

  getCountryCode(ip: string): string | null {
    if (!this.reader) {
      void this.telemetry.geoIpFailure('reader_not_initialized');
      return null;
    }
    if (!ip || !validateIp(ip)) {
      void this.telemetry.invalidIp();
      return null;
    }
    if (isPrivateOrReservedAddress(ip)) {
      void this.telemetry.unknownCountry('private_or_reserved_ip');
      return null;
    }

    try {
      const lookupResult = this.reader.get(ip);
      const iso =
        lookupResult?.country?.iso_code ??
        lookupResult?.registered_country?.iso_code;
      if (!iso) {
        void this.telemetry.unknownCountry('missing_geoip_record');
        return null;
      }
      const normalized = normalizeCountryCode(iso);
      if (!normalized) {
        void this.telemetry.unknownCountry('invalid_geoip_country_code');
        return null;
      }
      return normalized;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      void this.telemetry.geoIpFailure(reason);
      return null;
    }
  }
}
