import { REDACTED } from './constants';
import { isSensitiveQueryKey } from './sensitive-keys';

export function redactQuery(
  query?: Record<string, unknown>,
): Record<string, unknown> {
  if (!query) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    result[key] = isSensitiveQueryKey(key) ? REDACTED : value;
  }
  return result;
}
