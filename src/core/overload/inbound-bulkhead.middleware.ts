import { Injectable, NestMiddleware } from '@nestjs/common';
import { get } from 'lodash';
import { IncomingMessage, ServerResponse } from 'http';
import { OverloadRejectedError } from './errors/overload-rejected.error';
import { InboundBulkheadService } from './inbound-bulkhead.service';
import { isPressureExemptPath } from './is-pressure-exempt-path';

@Injectable()
export class InboundBulkheadMiddleware implements NestMiddleware {
  constructor(private readonly bulkhead: InboundBulkheadService) {}

  use(req: IncomingMessage, res: ServerResponse, next: (error?: Error) => void): void {
    if (!this.bulkhead.isEnabled()) {
      next();
      return;
    }

    const url = typeof req.url === 'string' ? req.url : '';
    if (isPressureExemptPath(url)) {
      next();
      return;
    }

    if (!this.bulkhead.tryAcquire()) {
      next(new OverloadRejectedError());
      return;
    }

    let released = false;
    const releaseOnce = (): void => {
      if (released) {
        return;
      }
      released = true;
      this.bulkhead.release();
    };

    const raw = get(res, 'raw', res) as ServerResponse;
    raw.once('finish', releaseOnce);
    raw.once('close', releaseOnce);

    next();
  }
}
