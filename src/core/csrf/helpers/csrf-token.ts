import { randomBytes, timingSafeEqual } from 'crypto';

const TOKEN_BYTE_LENGTH = 32;

export function generateCsrfToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
}

export function csrfTokensMatch(
  cookieValue: string | undefined,
  headerValue: string | undefined,
): boolean {
  if (!cookieValue || !headerValue) {
    return false;
  }
  const a = Buffer.from(cookieValue, 'utf8');
  const b = Buffer.from(headerValue, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
