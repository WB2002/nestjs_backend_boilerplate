import { RateLimitIdentifier } from '../enums/rate-limit-identifier.enum';
import { RateLimitStorage } from '../enums/rate-limit-storage.enum';
import { hashRouteScope } from './hash-route-scope';

export function buildRateLimitKey(params: {
  policy?: string;
  identifier: RateLimitIdentifier;
  tracker: string;
  routeScope: string;
  storage: RateLimitStorage;
  hashRouteScope?: boolean;
}): string {
  const shouldHash =
    params.hashRouteScope ?? params.storage === RateLimitStorage.Redis;
  const scope = shouldHash
    ? hashRouteScope(params.routeScope)
    : params.routeScope;
  const policy = params.policy || 'default';
  return `rl:${policy}:${params.identifier}:${params.tracker}:${scope}`;
}
