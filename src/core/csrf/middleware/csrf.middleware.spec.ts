import { HttpAdapterHost } from '@nestjs/core';
import { CsrfMiddleware } from './csrf.middleware';
import { CsrfTokenService } from '../csrf-token.service';
import { CSRF_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE } from '@/common/constants';

describe('CsrfMiddleware', () => {
  const tokenService = new CsrfTokenService();
  const reply = { code: jest.fn().mockReturnThis(), send: jest.fn() };
  const middleware = new CsrfMiddleware(
    { httpAdapter: { getInstance: () => ({}) } } as HttpAdapterHost,
    tokenService,
    {
      enabled: true,
      cookieName: CSRF_TOKEN_COOKIE,
      headerName: 'x-csrf-token',
      exemptPaths: ['/health'],
    },
  );

  it('passes through GET requests', () => {
    middleware.enforceOnRequest(
      { method: 'GET', url: '/any' } as never,
      reply as never,
    );
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('passes exempt paths', () => {
    middleware.enforceOnRequest(
      {
        method: 'POST',
        url: '/health',
        cookies: { [ACCESS_TOKEN_COOKIE]: 'x' },
      } as never,
      reply as never,
    );
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('rejects POST with cookie session but no matching header', () => {
    reply.code.mockClear();
    middleware.enforceOnRequest(
      {
        method: 'POST',
        url: '/auth/logout',
        cookies: {
          [ACCESS_TOKEN_COOKIE]: 'jwt',
          [CSRF_TOKEN_COOKIE]: 'abc',
        },
        headers: {},
      } as never,
      reply as never,
    );
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('passes POST when cookie and header match', () => {
    reply.code.mockClear();
    const token = tokenService.generateToken();
    middleware.enforceOnRequest(
      {
        method: 'POST',
        url: '/auth/logout',
        cookies: {
          [ACCESS_TOKEN_COOKIE]: 'jwt',
          [CSRF_TOKEN_COOKIE]: token,
        },
        headers: { 'x-csrf-token': token },
      } as never,
      reply as never,
    );
    expect(reply.code).not.toHaveBeenCalled();
  });
});
