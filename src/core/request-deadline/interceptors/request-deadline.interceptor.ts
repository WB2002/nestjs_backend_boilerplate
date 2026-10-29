import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import {
  DEFAULT_REQUEST_DEADLINE_OPTIONS,
  REQUEST_DEADLINE_OPTIONS,
  REQUEST_TIMEOUT_KEY,
  SKIP_REQUEST_DEADLINE_KEY,
} from '../constants/request-deadline.constants';
import { DeadlineContext } from '../context/deadline.context';
import { RequestCancelledError } from '../errors/request-cancelled.error';
import { RequestDeadlineExceededError } from '../errors/request-deadline-exceeded.error';
import {
  parseTimeoutHeader,
  resolveTimeoutMs,
} from '../helpers/resolve-timeout-ms';
import {
  RequestDeadlineModuleOptions,
  RequestDeadlineStore,
} from '../types/request-deadline.types';

/**
 * Applies route-level @SkipRequestDeadline / @RequestTimeout after Nest
 * resolves the handler, and bridges AbortSignal → Observable errors so the
 * exception filter can map timeout/disconnect to 504/499.
 */
@Injectable()
export class RequestDeadlineInterceptor implements NestInterceptor {
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;

  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(REQUEST_DEADLINE_OPTIONS)
    options?: RequestDeadlineModuleOptions,
  ) {
    this.defaultTimeoutMs =
      options?.defaultTimeoutMs ??
      DEFAULT_REQUEST_DEADLINE_OPTIONS.defaultTimeoutMs;
    this.maxTimeoutMs =
      options?.maxTimeoutMs ?? DEFAULT_REQUEST_DEADLINE_OPTIONS.maxTimeoutMs;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const store = DeadlineContext.get();
    const internals = DeadlineContext.getInternals(store?.signal);
    if (!store || !internals) {
      return next.handle();
    }

    const shouldSkipDeadline = this.reflector.getAllAndOverride<boolean>(
      SKIP_REQUEST_DEADLINE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (shouldSkipDeadline) {
      internals.clearTimer();
      return this.bridgeAbort(store, next);
    }

    const routeOverrideMs = this.reflector.getAllAndOverride<number>(
      REQUEST_TIMEOUT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context
      .switchToHttp()
      .getRequest<{ headers?: Record<string, unknown> }>();
    const headerMs = parseTimeoutHeader(req?.headers);

    const resolvedRouteOverrideMs =
      typeof routeOverrideMs === 'number' && routeOverrideMs > 0
        ? routeOverrideMs
        : undefined;
    const { timeoutMs } = resolveTimeoutMs({
      ...(headerMs !== undefined ? { headerMs } : {}),
      ...(resolvedRouteOverrideMs !== undefined
        ? { routeOverrideMs: resolvedRouteOverrideMs }
        : {}),
      defaultTimeoutMs: this.defaultTimeoutMs,
      maxTimeoutMs: this.maxTimeoutMs,
    });

    if (timeoutMs !== undefined) {
      internals.rescheduleFromStart(timeoutMs);
      const res = context.switchToHttp().getResponse<{
        setHeader?: (name: string, value: string | number) => void;
      }>();
      res?.setHeader?.('x-request-deadline', String(store.deadlineAt));
    }

    return this.bridgeAbort(store, next);
  }

  private bridgeAbort(
    store: RequestDeadlineStore,
    next: CallHandler,
  ): Observable<unknown> {
    const { signal } = store;
    return new Observable((subscriber) => {
      const onAbort = (): void => {
        const reason = store.reason ?? DeadlineContext.get()?.reason;
        if (reason === 'client_disconnected') {
          subscriber.error(new RequestCancelledError());
          return;
        }
        subscriber.error(new RequestDeadlineExceededError());
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });
      const sub = next.handle().subscribe({
        next: (value) => subscriber.next(value),
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

      return () => {
        signal.removeEventListener('abort', onAbort);
        sub.unsubscribe();
      };
    });
  }
}
