const register = jest.fn().mockResolvedValue(undefined);
const logout = jest.fn().mockResolvedValue(undefined);

jest.mock('../auth.service', () => ({
  AuthService: jest.fn().mockImplementation(() => ({
    register,
    logout,
  })),
}));

import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { ConfigService } from '@nestjs/config';
import { CsrfTokenService } from '@/core/csrf/csrf-token.service';
import { SESSION_ID_COOKIE } from '@/common/constants';

describe('AuthController register and logout', () => {
  const authService = new AuthService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const createController = () =>
    new AuthController(
      authService,
      new ConfigService(),
      new CsrfTokenService(),
    );

  beforeEach(() => {
    register.mockClear();
    logout.mockClear();
  });

  it('register returns success message after persisting the user', async () => {
    const controller = createController();
    const dto = { email: 'new@example.com', password: 'secret123' };

    await expect(controller.register(dto)).resolves.toEqual({
      message: 'User registered successfully',
    });
    expect(register).toHaveBeenCalledWith(dto);
  });

  it('logout prefers session id from cookie over body and jti', async () => {
    const controller = createController();
    const clearCookie = jest.fn();

    await controller.logout(
      {
        cookies: { [SESSION_ID_COOKIE]: 'session-cookie' },
        user: { jti: 'jwt-jti' },
      } as never,
      'session-body',
      { clearCookie } as never,
    );

    expect(logout).toHaveBeenCalledWith('session-cookie');
    expect(clearCookie).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ path: '/' }),
    );
    expect(clearCookie).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ path: '/auth/refresh' }),
    );
  });

  it('logout falls back to body session id when cookie is absent', async () => {
    const controller = createController();

    await controller.logout(
      {
        cookies: {},
        user: { jti: 'jwt-jti' },
      } as never,
      'session-body',
      { clearCookie: jest.fn() } as never,
    );

    expect(logout).toHaveBeenCalledWith('session-body');
  });

  it('logout falls back to jwt jti when cookie and body are absent', async () => {
    const controller = createController();

    await controller.logout(
      {
        cookies: {},
        user: { jti: 'jwt-jti' },
      } as never,
      '',
      { clearCookie: jest.fn() } as never,
    );

    expect(logout).toHaveBeenCalledWith('jwt-jti');
  });
});
