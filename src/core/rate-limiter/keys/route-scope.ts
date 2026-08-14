import { ExecutionContext } from '@nestjs/common';
import { getHttpRequest } from '../http/get-http-request';

/**
 * Stable route scope for keys.
 * Uses matched Nest/Fastify route pattern only — never raw attacker-controlled URLs.
 */
export function resolveRouteScope(
  context: ExecutionContext,
  keyScope: 'route' | 'global' = 'route',
): string {
  if (keyScope === 'global') {
    return 'app';
  }

  const req = getHttpRequest(context);
  const method = (req.method || 'GET').toUpperCase();
  const matched = req.routeOptions?.url;
  if (!matched) {
    return 'app:unmatched';
  }
  const path = matched.replace(/\/+$/, '') || '/';
  return `${method}:${path.startsWith('/') ? path : `/${path}`}`;
}
