import { createHash } from 'crypto';

/**
 * Stable short hash for Redis key segments.
 *
 * @example
 * // routeScope: "POST:/auth/login"
 * // without hash: rl:default:ip:203.0.113.10:POST:/auth/login
 * // with hash:    rl:default:ip:203.0.113.10:a3f9c2e1b8d0476a
 */
export function hashRouteScope(routeScope: string): string {
  return createHash('sha256').update(routeScope).digest('hex').slice(0, 16);
}
