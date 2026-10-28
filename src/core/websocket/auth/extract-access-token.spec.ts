import { ACCESS_TOKEN_COOKIE } from '@/common/constants';
import { extractAccessToken } from './extract-access-token';

describe('extractAccessToken', () => {
  it('reads bearer header first', () => {
    const token = extractAccessToken(
      {
        headers: {
          authorization: 'Bearer header-token',
          cookie: `${ACCESS_TOKEN_COOKIE}=cookie-token`,
        },
      },
      { allowQueryToken: false },
    );
    expect(token).toBe('header-token');
  });

  it('reads cookie when no bearer', () => {
    const token = extractAccessToken(
      {
        headers: { cookie: `${ACCESS_TOKEN_COOKIE}=cookie-token` },
      },
      { allowQueryToken: false },
    );
    expect(token).toBe('cookie-token');
  });

  it('reads handshake.auth.token for mobile clients', () => {
    const token = extractAccessToken(
      { headers: {}, auth: { token: 'mobile-token' } },
      { allowQueryToken: false },
    );
    expect(token).toBe('mobile-token');
  });

  it('ignores query token unless allowed', () => {
    const token = extractAccessToken(
      { headers: {}, query: { access_token: 'query-token' } },
      { allowQueryToken: false },
    );
    expect(token).toBeNull();
  });
});
