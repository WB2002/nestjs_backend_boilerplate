import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { get } from 'lodash';
import type { ServerResponse } from 'http';
import { getRequestSignal, remainingMs } from '@/core/request-deadline';
import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { isPressureExemptPath } from '../is-pressure-exempt-path';
import {
  INBOUND_LOAD_LEVEL_OPTIONS,
  PRIORITY_SHEDDING_OPTIONS,
  SKIP_INBOUND_BULKHEAD_KEY,
} from '../overload.constants';
import { resolveApiPriority } from '../priority/resolve-api-priority';
import { shouldShedPriorityRequest } from '../priority/should-shed-priority-request';
import { PrioritySheddingConfig } from '../priority/priority-shedding.types';
import { PriorityShedRejectedError } from '../errors/priority-shed-rejected.error';
import { InboundLoadLevelConfig } from '../load-level/inbound-load-level.types';

@Injectable()
export class InboundPriorityBulkheadGuard implements CanActivate {
  constructor(
    private readonly bulkhead: InboundBulkheadService,
    private readonly reflector: Reflector,
    @Inject(PRIORITY_SHEDDING_OPTIONS)
    private readonly sheddingConfig: PrioritySheddingConfig,
    @Inject(INBOUND_LOAD_LEVEL_OPTIONS)
    private readonly loadLevelConfig: InboundLoadLevelConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    const configuredWait = this.loadLevelConfig.maxWaitMs;
    const budget = remainingMs();
    const maxWaitMs =
      budget === undefined ? configuredWait : Math.min(configuredWait, budget);

    const signal = getRequestSignal();
    await this.bulkhead.acquire({
      priority,
      maxWaitMs,
      ...(signal !== undefined ? { signal } : {}),
    });

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
