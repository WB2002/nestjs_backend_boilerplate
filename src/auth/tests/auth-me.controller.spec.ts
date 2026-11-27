jest.mock('../auth.service', () => ({
  AuthService: jest.fn().mockImplementation(() => ({})),
}));

import { AuthController } from '../auth.controller';
import { CsrfTokenService } from '@/core/csrf/csrf-token.service';

describe('AuthController getMe', () => {
  it('returns the authenticated user id and email without leaking password or jti', () => {
    const controller = new AuthController(
      {} as never,
      { get: jest.fn() } as never,
      new CsrfTokenService(),
    );

    const profile = controller.getMe({
      user: {
        id: 'user-123',
        email: 'user@example.com',
        password: 'hashed-password',
        jti: 'session-jti',
      },
    } as never);

    expect(profile).toEqual({
      id: 'user-123',
      email: 'user@example.com',
    });
  });
});
