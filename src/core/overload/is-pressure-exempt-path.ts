import { PRESSURE_EXEMPT_PATHS } from './overload.constants';

export function normalizeRequestPath(url: string): string {
  const raw = url.split('?')[0] ?? url;
  if (raw.length > 1 && raw.endsWith('/')) {
    return raw.slice(0, -1);
  }
  return raw;
}

export function isPressureExemptPath(url: string): boolean {
  const path = normalizeRequestPath(url);
  return (PRESSURE_EXEMPT_PATHS as readonly string[]).includes(path);
}
