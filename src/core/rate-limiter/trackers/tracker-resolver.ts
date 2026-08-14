import { ExecutionContext } from '@nestjs/common';
import { RateLimitIdentifier } from '../enums/rate-limit-identifier.enum';
import { RateLimiterModuleOptions } from '../types/rate-limit.types';
import { getHttpRequest } from '../http/get-http-request';
import { resolveIpTracker } from './ip-tracker';
import { resolveUserTracker } from './user-tracker';
import { resolveGuestTracker } from './guest-tracker';
import { resolveFingerprintTracker } from './fingerprint-tracker';

export function resolveTracker(
  context: ExecutionContext,
  identifier: RateLimitIdentifier,
  options: RateLimiterModuleOptions,
): string | null {
  const req = getHttpRequest(context);

  switch (identifier) {
    case RateLimitIdentifier.Ip:
      return resolveIpTracker(req);
    case RateLimitIdentifier.UserId:
      return resolveUserTracker(req);
    case RateLimitIdentifier.GuestId:
      return resolveGuestTracker(req, options);
    case RateLimitIdentifier.DeviceFingerprint:
      return resolveFingerprintTracker(req, options);
    default:
      return null;
  }
}
