import { REDACTED } from './constants';
import { isSensitiveHeaderName } from './sensitive-keys';

export function redactHeaders(
  headers?: Record<string, string | string[] | undefined>,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  const redactedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    const normalized = Array.isArray(value) ? value.join(', ') : value;
    redactedHeaders[key] = isSensitiveHeaderName(key) ? REDACTED : normalized;
  }
  return redactedHeaders;
}
