import { FastifyReply } from 'fastify';
import { CSRF_TOKEN_COOKIE } from '@/common/constants';
import { getCsrfTokenCookieOptions } from '@/common/utils';

export function setCsrfCookie(
  reply: FastifyReply,
  token: string,
  cookieName: string = CSRF_TOKEN_COOKIE,
): void {
  reply.setCookie(cookieName, token, getCsrfTokenCookieOptions());
}
