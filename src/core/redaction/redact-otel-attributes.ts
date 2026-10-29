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

function redactOtelStringAttribute(
  key: string,
  value: string,
): RedactedOtelAttributeValue {
  if (HEADER_JSON_KEYS.has(key)) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(redactHeaders(parsed as Record<string, string>));
      }
      return redactForLog(value) as string;
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

function redactOtelArrayAttribute(
  value: unknown[],
): Array<string | number | boolean> {
  // eslint-disable-next-line sonarjs/function-return-type -- primitive OTEL array elements only
  return value.map((attributeValue): string | number | boolean => {
    if (typeof attributeValue === 'string') {
      return String(redactForLog(attributeValue));
    }
    if (
      typeof attributeValue === 'number' ||
      typeof attributeValue === 'boolean'
    ) {
      return attributeValue;
    }
    return String(redactForLog(attributeValue));
  });
}

function redactOtelObjectAttribute(value: unknown): string {
  return JSON.stringify(redactForLog(value));
}

export function redactOtelAttributeValue(
  key: string,
  value: unknown,
): RedactedOtelAttributeValue | undefined {
  if (value == null) {
    return undefined;
  }

  let redacted: RedactedOtelAttributeValue;
  if (typeof value === 'string') {
    redacted = redactOtelStringAttribute(key, value);
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    redacted = value;
  } else if (Array.isArray(value)) {
    redacted = redactOtelArrayAttribute(value);
  } else {
    redacted = redactOtelObjectAttribute(value);
  }
  return redacted;
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
