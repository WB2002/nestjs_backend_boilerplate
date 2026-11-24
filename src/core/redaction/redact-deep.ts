import { REDACTED } from './constants';
import { isSensitiveLogKey } from './sensitive-keys';
import { looksLikeSensitiveValue } from './redact-value-patterns';

const MAX_DEPTH = 8;
const REDACTED_DEPTH = '[REDACTED_DEPTH]';

function redactString(value: string): string {
  return looksLikeSensitiveValue(value) ? REDACTED : value;
}

export function redactForLog(
  value: unknown,
  depth = 0,
  seen?: WeakSet<object>,
): unknown {
  if (depth > MAX_DEPTH) {
    return REDACTED_DEPTH;
  }
  if (
    value == null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    const visited = seen ?? new WeakSet<object>();
    if (visited.has(value)) {
      return REDACTED;
    }
    visited.add(value);
    return value.map((nestedValue) =>
      redactForLog(nestedValue, depth + 1, visited),
    );
  }
  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'object') {
    const visited = seen ?? new WeakSet<object>();
    if (visited.has(value)) {
      return REDACTED;
    }
    visited.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        isSensitiveLogKey(key)
          ? REDACTED
          : redactForLog(child, depth + 1, visited),
      ]),
    );
  }
  return value;
}
