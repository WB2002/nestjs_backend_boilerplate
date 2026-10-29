import { ACCESS_TOKEN_COOKIE, SESSION_ID_COOKIE } from '@/common/constants';
import { readCookieField, readStringRecordField } from '@/common/utils';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const direct = readStringRecordField(headers, name);
  if (direct !== undefined) {
    return direct;
  }
  return readStringRecordField(headers, name.toLowerCase());
}

function hasBearerAuth(headers: Record<string, unknown> | undefined): boolean {
  const auth = headerValue(headers, 'authorization');
  return typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ');
}

function hasSessionCookies(
  cookies: Record<string, string> | undefined,
): boolean {
  if (!cookies) {
    return false;
  }
  return Boolean(
    readCookieField(cookies, ACCESS_TOKEN_COOKIE) ||
    readCookieField(cookies, SESSION_ID_COOKIE),
  );
}

export function shouldEnforceCsrf(req: {
  method?: string;
  headers?: Record<string, unknown>;
  cookies?: Record<string, string>;
}): boolean {
  const method = (req.method ?? 'GET').toUpperCase();
  if (!UNSAFE_METHODS.has(method)) {
    return false;
  }
  if (hasBearerAuth(req.headers)) {
    return false;
  }
  if (!hasSessionCookies(req.cookies)) {
    return false;
  }
  return true;
}
