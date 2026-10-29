import { REDACTED } from './constants';
import {
  redactOtelAttributeValue,
  redactOtelAttributes,
} from './redact-otel-attributes';

describe('redactOtelAttributes', () => {
  it('redacts sensitive keys and jwt-like string values', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig';
    const out = redactOtelAttributes({
      'http.url': 'https://api.example.com?access_token=sekrit',
      email: 'user@example.com',
      'http.request.headers': JSON.stringify({
        Authorization: `Bearer ${jwt}`,
      }),
      'http.method': 'GET',
    });
    expect(out.email).toBe(REDACTED);
    expect(String(out['http.url'])).not.toContain('sekrit');
    expect(String(out['http.request.headers'])).not.toContain(jwt);
    expect(out['http.method']).toBe('GET');
  });

  it('parses and redacts JSON string header blobs', () => {
    const out = redactOtelAttributeValue(
      'http.request.headers',
      JSON.stringify({ 'X-Api-Key': 'super-secret' }),
    );
    expect(String(out)).toContain(REDACTED);
    expect(String(out)).not.toContain('super-secret');
  });
});
