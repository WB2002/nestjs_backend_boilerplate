import { redactUrl } from './redact-url';

const ABSOLUTE_URL = /https?:\/\/[^\s'"]+/gi;
const RELATIVE_WITH_QUERY = /\/[^\s'"]*\?[^\s'"]+/gi;

export function redactLogMessage(message: string): string {
  let out = message.replace(ABSOLUTE_URL, (match) => redactUrl(match));
  out = out.replace(RELATIVE_WITH_QUERY, (match) => redactUrl(match));
  return out;
}
