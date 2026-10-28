import { ACCESS_TOKEN_COOKIE, SESSION_ID_COOKIE } from '@/common/constants';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const direct = headers[name];
  if (typeof direct === 'string') {
    return direct;
  }
  const lower = headers[name.toLowerCase()];
  return typeof lower === 'string' ? lower : undefined;
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
  return Boolean(cookies[ACCESS_TOKEN_COOKIE] || cookies[SESSION_ID_COOKIE]);
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
