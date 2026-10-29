import { REDACTED } from './constants';
import { isSensitiveHeaderName } from './sensitive-keys';

export function redactHeaders(
  headers?: Record<string, string | string[] | undefined>,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value != null)
      .map(([key, value]) => {
        const normalized = Array.isArray(value)
          ? value.join(', ')
          : String(value);
        return [
          key,
          isSensitiveHeaderName(key) ? REDACTED : normalized,
        ] as const;
      }),
  ) as Record<string, string>;
}
