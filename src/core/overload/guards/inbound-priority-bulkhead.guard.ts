import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { get } from 'lodash';
import type { ServerResponse } from 'http';
import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { OverloadRejectedError } from '../errors/overload-rejected.error';
import { PriorityShedRejectedError } from '../errors/priority-shed-rejected.error';
import { isPressureExemptPath } from '../is-pressure-exempt-path';
import {
  PRIORITY_SHEDDING_OPTIONS,
  SKIP_INBOUND_BULKHEAD_KEY,
} from '../overload.constants';
import { resolveApiPriority } from '../priority/resolve-api-priority';
import { shouldShedPriorityRequest } from '../priority/should-shed-priority-request';
import { PrioritySheddingConfig } from '../priority/priority-shedding.types';

@Injectable()
export class InboundPriorityBulkheadGuard implements CanActivate {
  constructor(
    private readonly bulkhead: InboundBulkheadService,
    private readonly reflector: Reflector,
    @Inject(PRIORITY_SHEDDING_OPTIONS)
    private readonly sheddingConfig: PrioritySheddingConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    if (!this.bulkhead.isEnabled()) {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_INBOUND_BULKHEAD_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{ url?: string }>();
    const url = typeof req.url === 'string' ? req.url : '';
    if (isPressureExemptPath(url)) {
      return true;
    }

    const priority = resolveApiPriority(
      this.reflector,
      context,
      this.sheddingConfig,
    );

    if (
      this.sheddingConfig.enabled &&
      shouldShedPriorityRequest({
        active: this.bulkhead.activeCount,
        maxInFlight: this.bulkhead.maxInFlight,
        priority,
        thresholds: this.sheddingConfig.thresholds,
      })
    ) {
      throw new PriorityShedRejectedError();
    }

    if (!this.bulkhead.tryAcquire()) {
      throw new OverloadRejectedError();
    }

    this.attachRelease(context);
    return true;
  }

  private attachRelease(context: ExecutionContext): void {
    const res = context.switchToHttp().getResponse<ServerResponse>();
    const raw = get(res, 'raw', res) as ServerResponse;
    let released = false;
    const releaseOnce = (): void => {
      if (released) {
        return;
      }
      released = true;
      this.bulkhead.release();
    };
    raw.once('finish', releaseOnce);
    raw.once('close', releaseOnce);
  }
}
