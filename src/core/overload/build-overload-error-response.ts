import { randomUUID } from 'crypto';
import { FastifyRequest } from 'fastify';
import { OverloadErrorBody } from './overload.types';

export function buildOverloadErrorResponse(
  request: Pick<FastifyRequest, 'url' | 'headers'>,
  message = 'Service temporarily unavailable',
): OverloadErrorBody {
  const requestIdHeader = request.headers['x-request-id'];
  const requestId =
    typeof requestIdHeader === 'string' && requestIdHeader.length > 0
      ? requestIdHeader
      : randomUUID();

  return {
    statusCode: 503,
    timestamp: new Date().toISOString(),
    path: request.url,
    requestId,
    message,
  };
}
