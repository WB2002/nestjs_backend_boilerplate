import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  COUNTRY_ACCESS_OPTIONS,
  COUNTRY_ACCESS_REPOSITORY,
  GEO_LOCATION_SERVICE,
  POSTGRES_POOL,
} from './constants';
import {
  parseCountryAccessOptions,
  type CountryAccessModuleOptions,
} from './config/country-access.config';
import { CountryAccessService } from './country-access.service';
import { ClientIpService } from './client-ip/client-ip.service';
import { CountryAccessGuard } from './guards/country-access.guard';
import {
  MaxMindGeoLocationService,
  MAXMIND_READER,
} from './geo/maxmind-geo-location.service';
import {
  createPostgresPool,
  PostgresPoolLifecycle,
} from './persistence/postgres/postgres.pool';
import { PostgresCountryAccessRepository } from './persistence/postgres/postgres-country-access.repository';
import { MongoCountryAccessRepository } from './persistence/mongo/mongo-country-access.repository';
import {
  CountryAccessDocument,
  CountryAccessSchema,
} from './persistence/mongo/country-access.schema';
import { CountryAccessTelemetry } from './telemetry/country-access.telemetry';

/**
 * Default binding uses PostgreSQL. Set COUNTRY_ACCESS_PERSISTENCE_PROVIDER=mongodb
 * to use MongoDB (e.g. when running without Postgres).
 */
const DEFAULT_PERSISTENCE_PROVIDER = 'postgres' as const;

const repositoryProvider: Provider = {
  provide: COUNTRY_ACCESS_REPOSITORY,
  inject: [
    COUNTRY_ACCESS_OPTIONS,
    PostgresCountryAccessRepository,
    MongoCountryAccessRepository,
  ],
  useFactory: (
    options: CountryAccessModuleOptions,
    postgresRepo: PostgresCountryAccessRepository,
    mongoRepo: MongoCountryAccessRepository,
  ) => (options.persistenceProvider === 'mongodb' ? mongoRepo : postgresRepo),
};

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CountryAccessDocument.name, schema: CountryAccessSchema },
    ]),
  ],
  providers: [
    {
      provide: COUNTRY_ACCESS_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): CountryAccessModuleOptions =>
        parseCountryAccessOptions(
          {
            COUNTRY_ACCESS_REFRESH_INTERVAL_MS: config.get<string>(
              'COUNTRY_ACCESS_REFRESH_INTERVAL_MS',
            ),
            GEOIP_DATABASE_PATH: config.get<string>('GEOIP_DATABASE_PATH'),
            COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY: config.get<string>(
              'COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY',
            ),
            COUNTRY_ACCESS_BYPASS_PATHS: config.get<string>(
              'COUNTRY_ACCESS_BYPASS_PATHS',
            ),
            COUNTRY_ACCESS_PERSISTENCE_PROVIDER: config.get<string>(
              'COUNTRY_ACCESS_PERSISTENCE_PROVIDER',
            ),
            POSTGRES_HOST: config.get<string>('POSTGRES_HOST'),
            POSTGRES_PORT: config.get<string>('POSTGRES_PORT'),
            POSTGRES_USER: config.get<string>('POSTGRES_USER'),
            POSTGRES_PASSWORD: config.get<string>('POSTGRES_PASSWORD'),
            POSTGRES_DB: config.get<string>('POSTGRES_DB'),
          },
          DEFAULT_PERSISTENCE_PROVIDER,
        ),
    },
    {
      provide: POSTGRES_POOL,
      inject: [COUNTRY_ACCESS_OPTIONS],
      useFactory: (options: CountryAccessModuleOptions) =>
        createPostgresPool(options.postgres),
    },
    PostgresPoolLifecycle,
    PostgresCountryAccessRepository,
    MongoCountryAccessRepository,
    repositoryProvider,
    CountryAccessTelemetry,
    CountryAccessService,
    ClientIpService,
    {
      provide: MAXMIND_READER,
      useValue: null,
    },
    MaxMindGeoLocationService,
    {
      provide: GEO_LOCATION_SERVICE,
      useExisting: MaxMindGeoLocationService,
    },
    CountryAccessGuard,
  ],
  exports: [
    CountryAccessService,
    ClientIpService,
    GEO_LOCATION_SERVICE,
    COUNTRY_ACCESS_REPOSITORY,
    CountryAccessTelemetry,
    CountryAccessGuard,
  ],
})
export class CountryAccessModule {}
