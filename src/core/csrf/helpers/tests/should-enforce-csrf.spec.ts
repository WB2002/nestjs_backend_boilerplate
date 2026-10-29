import { ACCESS_TOKEN_COOKIE, SESSION_ID_COOKIE } from '@/common/constants';
import { shouldEnforceCsrf } from '../should-enforce-csrf';

describe('shouldEnforceCsrf', () => {
  it('skips GET even with cookies', () => {
    expect(
      shouldEnforceCsrf({
        method: 'GET',
        cookies: { [ACCESS_TOKEN_COOKIE]: 'jwt' },
      }),
    ).toBe(false);
  });

  it('skips POST with Bearer auth', () => {
    expect(
      shouldEnforceCsrf({
        method: 'POST',
        headers: { authorization: 'Bearer abc' },
        cookies: { [ACCESS_TOKEN_COOKIE]: 'jwt' },
      }),
    ).toBe(false);
  });

  it('skips POST without session cookies', () => {
    expect(shouldEnforceCsrf({ method: 'POST', cookies: {} })).toBe(false);
  });

  it('enforces POST with access_token cookie and no Bearer', () => {
    expect(
      shouldEnforceCsrf({
        method: 'POST',
        cookies: { [ACCESS_TOKEN_COOKIE]: 'jwt' },
      }),
    ).toBe(true);
  });

  it('enforces refresh POST with session_id cookie only', () => {
    expect(
      shouldEnforceCsrf({
        method: 'POST',
        cookies: { [SESSION_ID_COOKIE]: 'uuid' },
      }),
    ).toBe(true);
  });
});
