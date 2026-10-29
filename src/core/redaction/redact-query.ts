import { REDACTED } from './constants';
import { isSensitiveQueryKey } from './sensitive-keys';

export function redactQuery(
  query?: Record<string, unknown>,
): Record<string, unknown> {
  if (!query) {
    return {};
  }
  const redactedQuery: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    redactedQuery[key] = isSensitiveQueryKey(key) ? REDACTED : value;
  }
  return redactedQuery;
}
