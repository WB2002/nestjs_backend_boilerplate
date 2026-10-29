import { redactUrl } from './redact-url';

const ABSOLUTE_URL = /https?:\/\/[^ \t\r\n'"]+/gi;
const RELATIVE_WITH_QUERY = /\/[^ \t\r\n'"]*\?[^ \t\r\n'"]+/gi;

export function redactLogMessage(message: string): string {
  let out = message.replace(ABSOLUTE_URL, (match) => redactUrl(match));
  out = out.replace(RELATIVE_WITH_QUERY, (match) => redactUrl(match));
  return out;
}
