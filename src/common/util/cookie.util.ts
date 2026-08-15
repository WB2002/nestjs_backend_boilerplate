import { CookieSerializeOptions } from "@fastify/cookie";

export const getAccessTokenCookieOptions = (
  ttl: number,
): CookieSerializeOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: ttl,
});

export const getSessionIdCookieOptions = (
  ttl: number,
): CookieSerializeOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/auth/refresh',
  maxAge: ttl,
});
