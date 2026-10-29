jest.mock('../auth.service', () => ({
  AuthService: jest.fn().mockImplementation(() => ({})),
}));

import { AuthController } from '../auth.controller';
import { CsrfTokenService } from '@/core/csrf/csrf-token.service';

describe('AuthController CSRF', () => {
  it('getCsrf sets cookie and returns token', async () => {
    const csrfTokenService = new CsrfTokenService();
    const res = { setCookie: jest.fn() };
    const controller = new AuthController(
      {} as never,
      { get: jest.fn() } as never,
      csrfTokenService,
    );
    const body = controller.getCsrf(res as never);
    expect(body.csrfToken).toEqual(expect.any(String));
    expect(res.setCookie).toHaveBeenCalled();
  });
});
