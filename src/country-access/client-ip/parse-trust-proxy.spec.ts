import { parseTrustProxy } from './parse-trust-proxy';

describe('parseTrustProxy', () => {
  it('defaults to false', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('parses boolean true', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(true);
  });

  it('parses explicit trusted proxy list', () => {
    expect(parseTrustProxy('10.0.0.1, 10.0.0.0/8')).toEqual([
      '10.0.0.1',
      '10.0.0.0/8',
    ]);
  });
});
