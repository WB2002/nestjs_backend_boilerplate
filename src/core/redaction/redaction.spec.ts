import {
  isSensitiveLogKey,
  redactHeaders,
  redactLogMessage,
  redactQuery,
  redactUrl,
} from './index';
import { redactForLog } from './redact-deep';

describe('core redaction (url/header/query)', () => {
  it('treats common log metadata keys as sensitive', () => {
    expect(isSensitiveLogKey('password')).toBe(true);
    expect(isSensitiveLogKey('email')).toBe(true);
    expect(isSensitiveLogKey('refreshToken')).toBe(true);
    expect(isSensitiveLogKey('requestId')).toBe(false);
  });

  it('redacts custom secret headers and URL userinfo/query secrets', () => {
    expect(redactHeaders({ 'X-Partner-Key': 'sekrit' })['X-Partner-Key']).toBe(
      '[REDACTED]',
    );
    const redacted = redactUrl(
      'https://user:pass@example.com/x?access_token=sekrit&ok=1',
    );
    expect(redacted).not.toContain('sekrit');
    expect(redacted).not.toContain('user:pass');
    expect(redacted).toContain('ok=1');
  });

  it('redacts common short query secret names like key and sig', () => {
    expect(redactQuery({ key: 'sekrit', sig: 'abc', ok: 1 })).toEqual({
      key: '[REDACTED]',
      sig: '[REDACTED]',
      ok: 1,
    });
  });
});

describe('redactForLog', () => {
  it('redacts by object key name', () => {
    expect(
      redactForLog({ email: 'user@example.com', requestId: 'abc' }),
    ).toEqual({
      email: '[REDACTED]',
      requestId: 'abc',
    });
  });

  it('redacts email-like strings even without sensitive key', () => {
    expect(redactForLog({ note: 'contact user@example.com please' })).toEqual({
      note: '[REDACTED]',
    });
  });

  it('redacts jwt-shaped strings', () => {
    const jwt = 'eyJaa.eyJbb.cc';
    expect(redactForLog({ debug: jwt })).toEqual({ debug: '[REDACTED]' });
  });

  it('preserves numbers and booleans', () => {
    expect(redactForLog({ count: 3, ok: true })).toEqual({
      count: 3,
      ok: true,
    });
  });
});

describe('redactLogMessage', () => {
  it('redacts sensitive query params inside access log lines', () => {
    const line = 'GET /auth/callback?access_token=sekrit&ok=1 302 - 4ms';
    const out = redactLogMessage(line);
    expect(out).not.toContain('sekrit');
    expect(out).toContain('ok=1');
  });
});
