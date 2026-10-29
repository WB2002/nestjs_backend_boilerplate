export interface CountryAccessConfig {
  countryCode: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type UnknownCountryPolicy = 'block' | 'allow';

export type CountryAccessServiceStatus = 'inactive' | 'active';

export type CountryAccessPersistenceProvider = 'postgres' | 'mongodb';
