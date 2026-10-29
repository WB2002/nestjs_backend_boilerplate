import { ISO_3166_1_ALPHA2_PATTERN } from '../constants';

export function normalizeCountryCode(raw: string): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim().toUpperCase();
  if (!ISO_3166_1_ALPHA2_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function assertCountryCode(raw: string): string {
  const normalized = normalizeCountryCode(raw);
  if (!normalized) {
    throw new Error(`Invalid ISO 3166-1 alpha-2 country code: ${raw}`);
  }
  return normalized;
}
