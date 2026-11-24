import { REDACTED } from './constants';
import { isSensitiveQueryKey } from './sensitive-keys';

const REDACT_RELATIVE_URL_BASE = 'https://redact.invalid';

export function redactUrl(url: string): string {
  if (!url.includes('?') && !url.includes('@') && url.startsWith('/')) {
    return url;
  }
  try {
    const parsed = /^https?:\/\//i.test(url)
      ? new URL(url)
      : new URL(url, REDACT_RELATIVE_URL_BASE);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    if (/^https?:\/\//i.test(url)) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}
