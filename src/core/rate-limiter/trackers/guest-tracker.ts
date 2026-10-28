import { FastifyRequest } from 'fastify';
import { MissingGuestIdError } from '../errors/missing-guest-id.error';
import { DEFAULT_GUEST_COOKIE_NAME } from '../constants/rate-limit.constants';
import { RateLimiterModuleOptions } from '../types/rate-limit.types';

export function resolveGuestTracker(
  req: FastifyRequest,
  options: RateLimiterModuleOptions,
): string {
  const guestCookieName =
    options.guestCookie?.name ?? DEFAULT_GUEST_COOKIE_NAME;
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> })
    .cookies;
  const value = cookies?.[guestCookieName];
  if (!value) {
    throw new MissingGuestIdError();
  }
  return value;
}
