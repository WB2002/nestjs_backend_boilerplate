export interface GeoLocationService {
  getCountryCode(ip: string): string | null;
}
