import type { SanitizeHtmlOptions } from '../types';

// sanitize-html is CJS; require keeps Jest (experimental-vm-modules) and Nest build stable.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sanitizeHtml = require('sanitize-html') as (
  value: string,
  options?: SanitizeHtmlOptions,
) => string;

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
