export const SKIP_SANITIZATION_KEY = 'sanitization:skip';
export const SANITIZE_HTML_KEY = 'sanitization:html';
export const SAFE_URL_KEY = 'sanitization:safeUrl';
export const REJECT_SQL_INJECTION_KEY = 'sanitization:rejectSqlInjection';
export const SKIP_SQL_INJECTION_KEY = 'sanitization:skipSqlInjection';

/** Keys skipped by global sanitization even without a DTO decorator. */
export const DEFAULT_SKIP_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
]);
