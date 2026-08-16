import * as sanitizeHtmlImport from 'sanitize-html';
import type { SanitizeHtmlOptions } from '../types';

const sanitizeHtml =
  typeof sanitizeHtmlImport === 'function'
    ? sanitizeHtmlImport
    : (sanitizeHtmlImport as unknown as { default: typeof sanitizeHtmlImport })
        .default;

const DEFAULT_OPTIONS: SanitizeHtmlOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

/**
 * Strip HTML/script content. Default allowlist is empty (text-only).
 * Defense against stored/reflected XSS when values are later rendered.
 */
export function sanitizeHtmlString(
  value: string,
  options: SanitizeHtmlOptions = DEFAULT_OPTIONS,
): string {
  return sanitizeHtml(value, { ...DEFAULT_OPTIONS, ...options });
}
