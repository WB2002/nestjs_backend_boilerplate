import { FastifyRequest } from 'fastify';

/**
 * Use Fastify-derived req.ip only. Behind ALB set TRUST_PROXY=true so this
 * is the client IP; do not read X-Forwarded-For here (spoof risk).
 */
export function resolveIpTracker(req: FastifyRequest): string {
  return req.ip || 'unknown';
}
