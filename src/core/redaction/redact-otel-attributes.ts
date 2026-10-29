import { REDACTED } from './constants';
import { redactForLog } from './redact-deep';
import { redactHeaders } from './redact-headers';
import { redactUrl } from './redact-url';
import { isSensitiveLogKey } from './sensitive-keys';

const HEADER_JSON_KEYS = new Set([
  'http.request.headers',
  'http.response.headers',
]);

/** OpenTelemetry-compatible span attribute values (plain JSON types). */
export type RedactedOtelAttributeValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>;

function redactKnownUrlKey(key: string, value: string): string {
  if (key === 'http.url' || key === 'url.full' || key === 'http.target') {
    return redactUrl(value);
  }
  return value;
}

export function redactOtelAttributeValue(
  key: string,
  value: unknown,
): RedactedOtelAttributeValue | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === 'string') {
    if (HEADER_JSON_KEYS.has(key)) {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          return JSON.stringify(
            redactHeaders(parsed as Record<string, string>),
          );
        }
      } catch {
        return redactForLog(value) as string;
      }
    }
    const urlRedacted = redactKnownUrlKey(key, value);
    if (urlRedacted !== value) {
      return urlRedacted;
    }
    if (isSensitiveLogKey(key)) {
      return REDACTED;
    }
    const deep = redactForLog(value);
    return typeof deep === 'string' ? deep : String(deep);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((attributeValue) =>
      typeof attributeValue === 'string'
        ? String(redactForLog(attributeValue))
        : attributeValue,
    );
  }

  return JSON.stringify(redactForLog(value));
}

export function redactOtelAttributes(
  attributes: Record<string, unknown>,
): Record<string, RedactedOtelAttributeValue> {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      redactOtelAttributeValue(key, value),
    ]),
  ) as Record<string, RedactedOtelAttributeValue>;
}
