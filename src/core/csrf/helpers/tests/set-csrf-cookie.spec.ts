import { getCsrfTokenCookieOptions } from '@/common/utils/cookie.utils';

describe('getCsrfTokenCookieOptions', () => {
  it('is readable by JavaScript (not httpOnly)', () => {
    const opts = getCsrfTokenCookieOptions();
    expect(opts.httpOnly).toBe(false);
    expect(opts.sameSite).toBe('strict');
    expect(opts.path).toBe('/');
  });
});
