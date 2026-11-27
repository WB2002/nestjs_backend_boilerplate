const createSession = jest.fn().mockResolvedValue({
  accessToken: 'access-token',
  sessionId: 'session-id',
});
const refreshSession = jest.fn().mockResolvedValue({
  accessToken: 'new-access-token',
  sessionId: 'new-session-id',
});

jest.mock('../auth.service', () => ({
  AuthService: jest.fn().mockImplementation(() => ({
    createSession,
    refreshSession,
  })),
}));

import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { CsrfTokenService } from '@/core/csrf/csrf-token.service';
import { ConfigService } from '@nestjs/config';

describe('AuthController login and refresh cookie TTL', () => {
  const authService = new AuthService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const createController = () => {
    const configService = new ConfigService({
      ACCESS_TOKEN_TTL: '900',
      SESSION_TTL: '604800',
    });
    return new AuthController(
      authService,
      configService,
      new CsrfTokenService(),
    );
  };

  beforeEach(() => {
    createSession.mockClear();
    refreshSession.mockClear();
  });

  it('login sets cookie maxAge from coerced ACCESS_TOKEN_TTL and SESSION_TTL seconds', async () => {
    const controller = createController();
    const setCookie = jest.fn();
    const res = { setCookie, clearCookie: jest.fn() };

    await controller.login(
      {} as never,
      {
        user: { id: 'user-1' },
        headers: {},
        ip: '127.0.0.1',
      } as never,
      res as never,
    );

    expect(createSession).toHaveBeenCalled();
    const maxAges = setCookie.mock.calls.map(
      (call: [string, string, { maxAge?: number }]) => call[2]?.maxAge,
    );
    expect(maxAges).toContain(900);
    expect(maxAges).toContain(604800);
  });

  it('refresh sets cookie maxAge from coerced TTL env strings', async () => {
    const controller = createController();
    const setCookie = jest.fn();
    const res = { setCookie, clearCookie: jest.fn() };

    await controller.refresh(
      { cookies: {} } as never,
      'session-from-body',
      res as never,
    );

    expect(refreshSession).toHaveBeenCalledWith('session-from-body');
    const maxAges = setCookie.mock.calls.map(
      (call: [string, string, { maxAge?: number }]) => call[2]?.maxAge,
    );
    expect(maxAges).toContain(900);
    expect(maxAges).toContain(604800);
  });
});
