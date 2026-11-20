import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { get } from 'lodash';
import type { ServerResponse } from 'http';
import { resolveExecutionHttpContext } from '@/common/http/get-execution-http-context';
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
    const httpContext = resolveExecutionHttpContext(context);
    if (!httpContext) {
      return true;
    }

    if (!this.bulkhead.isEnabled()) {
      return true;
    }

    const shouldSkip = this.reflector.getAllAndOverride<boolean>(
      SKIP_INBOUND_BULKHEAD_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (shouldSkip) {
      return true;
    }

    const url = httpContext.url;
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

    this.attachRelease(httpContext.res);
    return true;
  }

  private attachRelease(res: ServerResponse | { raw?: ServerResponse }): void {
    const raw = get(res, 'raw', res) as ServerResponse;
    let hasReleased = false;
    const releaseOnce = (): void => {
      if (hasReleased) {
        return;
      }
      hasReleased = true;
      this.bulkhead.release();
    };
    raw.once('finish', releaseOnce);
    raw.once('close', releaseOnce);
  }
}
