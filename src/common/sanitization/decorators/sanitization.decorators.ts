import {
  REJECT_SQL_INJECTION_KEY,
  SAFE_URL_KEY,
  SANITIZE_HTML_KEY,
  SKIP_SANITIZATION_KEY,
  SKIP_SQL_INJECTION_KEY,
} from '../constants';
import type { SanitizeHtmlOptions } from '../types';

function definePropertyMeta(
  key: string,
  value: unknown,
): PropertyDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(key, value, target, propertyKey);
  };
}

/** Skip all sanitization (XSS + SQLi + SafeUrl) for this field. */
export const SkipSanitization = (): PropertyDecorator =>
  definePropertyMeta(SKIP_SANITIZATION_KEY, true);

/** Override HTML allowlist for rich text (still runs SQLi checks unless skipped). */
export const SanitizeHtml = (
  options?: SanitizeHtmlOptions,
): PropertyDecorator => definePropertyMeta(SANITIZE_HTML_KEY, options ?? {});

/** Assert public http(s) URL including DNS resolution for this field. */
export const SafeUrl = (): PropertyDecorator =>
  definePropertyMeta(SAFE_URL_KEY, true);

/** Force SQL-injection rejection on (also the global default). */
export const RejectSqlInjection = (): PropertyDecorator =>
  definePropertyMeta(REJECT_SQL_INJECTION_KEY, true);

/** Skip only SQLi heuristics; XSS sanitization still applies. */
export const SkipSqlInjectionCheck = (): PropertyDecorator =>
  definePropertyMeta(SKIP_SQL_INJECTION_KEY, true);
