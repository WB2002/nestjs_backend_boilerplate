import { Injectable, NestMiddleware } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { trace } from '@opentelemetry/api';
import { isTraceExemptPath } from '@/core/telemetry/is-trace-exempt-path';
import { LoggerContext } from './logger.context';
import { IRequest, IResponse } from '@/types';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: IRequest, res: IResponse, next: (error?: Error) => void) {
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    const userId = req.user?.id || 'anonymous';
    const url = typeof req.url === 'string' ? req.url : '';
    const spanContext =
      !isTraceExemptPath(url) ? trace.getActiveSpan()?.spanContext() : undefined;

    LoggerContext.run(
      {
        requestId,
        userId,
        ...(spanContext?.traceId ? { traceId: spanContext.traceId } : {}),
        ...(spanContext?.spanId ? { spanId: spanContext.spanId } : {}),
      },
      () => {
      res.setHeader('x-request-id', requestId);
        next();
      },
    );
  }
}
