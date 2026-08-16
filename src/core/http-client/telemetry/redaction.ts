const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'set-cookie',
]);

const SENSITIVE_HEADER_PATTERN =
  /(secret|token|password|api-?key|(?:^|[-_])key$|auth)/i;

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'password',
  'passwd',
  'secret',
  'client_secret',
  'api_key',
  'apikey',
  'key',
  'sig',
  'signature',
  'credential',
]);

const SENSITIVE_QUERY_PATTERN =
  /(secret|token|password|passwd|api-?key|(?:^|[-_])key$|auth|sig|signature|credential)/i;

export function isSensitiveHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SENSITIVE_HEADER_NAMES.has(lower) || SENSITIVE_HEADER_PATTERN.test(lower)
  );
}

export function isSensitiveQueryKey(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_QUERY_KEYS.has(lower) || SENSITIVE_QUERY_PATTERN.test(lower);
}

export function redactHeaders(
  headers?: Record<string, string | string[] | undefined>,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    const normalized = Array.isArray(value) ? value.join(', ') : value;
    result[key] = isSensitiveHeaderName(key) ? '[REDACTED]' : normalized;
  }
  return result;
}

export function redactQuery(
  query?: Record<string, unknown>,
): Record<string, unknown> {
  if (!query) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    result[key] = isSensitiveQueryKey(key) ? '[REDACTED]' : value;
  }
  return result;
}

export function redactUrl(url: string): string {
  try {
    const parsed = /^https?:\/\//i.test(url)
      ? new URL(url)
      : new URL(url, 'http://redact.invalid');
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    if (/^https?:\/\//i.test(url)) {
      return parsed.toString();
    }
    // Preserve relative form (path + query + hash) without the placeholder origin.
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}
