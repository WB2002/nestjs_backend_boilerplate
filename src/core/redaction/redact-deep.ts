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
  seen: WeakSet<object> = new WeakSet(),
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
    if (seen.has(value)) {
      return REDACTED;
    }
    seen.add(value);
    return value.map((item) => redactForLog(item, depth + 1, seen));
  }
  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return REDACTED;
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (isSensitiveLogKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactForLog(child, depth + 1, seen);
    }
    return out;
  }
  return value;
}
