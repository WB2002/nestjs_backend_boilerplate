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
  let path = matched;
  while (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  if (path.length === 0) {
    path = '/';
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${method}:${normalizedPath}`;
}
