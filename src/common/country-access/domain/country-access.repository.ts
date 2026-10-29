import type { CountryAccessConfig } from './country-access-config';

export class CountryAccessConflictError extends Error {
  constructor(
    message = 'Country access configuration was modified concurrently',
  ) {
    super(message);
    this.name = 'CountryAccessConflictError';
  }
}

export interface CountryAccessRepository {
  getAll(): Promise<CountryAccessConfig[]>;

  getByCountryCode(countryCode: string): Promise<CountryAccessConfig | null>;

  upsert(config: CountryAccessConfig): Promise<CountryAccessConfig>;

  delete(countryCode: string): Promise<void>;
}
