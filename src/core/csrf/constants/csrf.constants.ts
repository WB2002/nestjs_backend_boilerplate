export const CSRF_TOKEN_HEADER = 'x-csrf-token';
export const CSRF_OPTIONS = 'CSRF_OPTIONS';

/** Reuse health probe paths — CSRF must not block ALB checks. */
export const DEFAULT_CSRF_EXEMPT_PATHS = ['/health', '/health/ready'] as const;

export const DEFAULT_CSRF_OPTIONS = {
  enabled: true,
  cookieName: 'csrf_token',
  headerName: CSRF_TOKEN_HEADER,
  exemptPaths: DEFAULT_CSRF_EXEMPT_PATHS,
} as const;
