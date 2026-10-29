import { CsrfTokenService } from '../csrf-token.service';

describe('CsrfTokenService', () => {
  const service = new CsrfTokenService();

  it('generateToken returns url-safe strings of fixed length', () => {
    const a = service.generateToken();
    const b = service.generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toEqual(b);
  });

  it('tokensMatch accepts equal cookie and header values', () => {
    const token = service.generateToken();
    expect(service.tokensMatch(token, token)).toBe(true);
  });

  it('tokensMatch rejects missing or mismatched values', () => {
    const token = service.generateToken();
    expect(service.tokensMatch(undefined, token)).toBe(false);
    expect(service.tokensMatch(token, undefined)).toBe(false);
    expect(service.tokensMatch(token, `${token}x`)).toBe(false);
  });
});
