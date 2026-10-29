import { REDACTED } from './constants';
import { isSensitiveQueryKey } from './sensitive-keys';

export function redactQuery(
  query?: Record<string, unknown>,
): Record<string, unknown> {
  if (!query) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      isSensitiveQueryKey(key) ? REDACTED : value,
    ]),
  );
}
