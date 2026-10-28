import { FastifyReply, FastifyRequest } from 'fastify';
import { buildOverloadErrorResponse } from './build-overload-error-response';
import { isPressureExemptPath } from './is-pressure-exempt-path';
import { recordUnderPressure503 } from './overload-telemetry';
import { UnderPressureConfig } from './overload.types';

/**
 * When pressureHandler omits reply.send, under-pressure lets the request proceed.
 * Health probes stay on Terminus/shutdown semantics only.
 */
export function createPressureHandler(config: UnderPressureConfig) {
  return (
    request: FastifyRequest,
    reply: FastifyReply,
    _type: string,
    _value: number | undefined,
  ): void => {
    if (isPressureExemptPath(request.url)) {
      return;
    }

    recordUnderPressure503({
      path: request.url,
      pressureType: _type,
    });
    const body = buildOverloadErrorResponse(request);
    void reply
      .code(503)
      .header('Retry-After', String(config.retryAfterSec))
      .send(body);
  };
}
