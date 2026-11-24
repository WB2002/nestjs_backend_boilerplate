import { CookieSerializeOptions } from '@fastify/cookie';

export const getAccessTokenCookieOptions = (
  ttl: number,
): CookieSerializeOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: Number(ttl),
});

export const getSessionIdCookieOptions = (
  ttl: number,
): CookieSerializeOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/auth/refresh',
  maxAge: Number(ttl),
});

export const getCsrfTokenCookieOptions = (): CookieSerializeOptions => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
});
