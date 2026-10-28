import { Injectable, NestMiddleware, Inject, Optional } from '@nestjs/common';
import {
  DEFAULT_REQUEST_DEADLINE_OPTIONS,
  REQUEST_DEADLINE_OPTIONS,
} from '../constants/request-deadline.constants';
import { DeadlineContext } from '../context/deadline.context';
import {
  parseTimeoutHeader,
  resolveTimeoutMs,
} from '../helpers/resolve-timeout-ms';
import {
  RequestDeadlineAbortReason,
  RequestDeadlineInternals,
  RequestDeadlineModuleOptions,
  RequestDeadlineStore,
} from '../types/request-deadline.types';

type HeaderBag = Record<string, unknown>;

interface DeadlineRequest {
  headers?: HeaderBag;
  raw?: {
    on?: (event: string, listener: (...args: unknown[]) => void) => void;
    off?: (event: string, listener: (...args: unknown[]) => void) => void;
    removeListener?: (
      event: string,
      listener: (...args: unknown[]) => void,
    ) => void;
  };
}

interface DeadlineResponse {
  setHeader?: (name: string, value: string | number) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
  raw?: {
    destroyed?: boolean;
    writableEnded?: boolean;
  };
}

/**
 * Owns AbortController for the request lifetime.
 * Application code only receives AbortSignal via DeadlineContext helpers.
 */
@Injectable()
export class RequestDeadlineMiddleware implements NestMiddleware {
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;

  constructor(
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

  use(
    req: DeadlineRequest,
    res: DeadlineResponse,
    next: (error?: Error) => void,
  ): void {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const headerMs = parseTimeoutHeader(req.headers);
    const { timeoutMs } = resolveTimeoutMs({
      ...(headerMs !== undefined ? { headerMs } : {}),
      defaultTimeoutMs: this.defaultTimeoutMs,
      maxTimeoutMs: this.maxTimeoutMs,
    });

    const startedAt = Date.now();
    const initialTimeoutMs = timeoutMs ?? this.maxTimeoutMs;
    const deadlineAt = startedAt + initialTimeoutMs;

    const store: RequestDeadlineStore = {
      signal: controller.signal,
      startedAt,
      deadlineAt,
    };

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const abort = (reason: RequestDeadlineAbortReason): void => {
      if (controller.signal.aborted) {
        return;
      }
      store.reason = reason;
      clearTimer();
      controller.abort(reason);
    };

    const armTimerForDeadline = (): void => {
      clearTimer();
      const remaining = Math.max(1, store.deadlineAt - Date.now());
      timer = setTimeout(() => abort('timeout'), remaining);
      timer.unref?.();
    };

    /**
     * Recompute absolute deadline from request start.
     * Never extends an already-tighter deadlineAt.
     */
    const rescheduleFromStart = (timeoutMsFromStart: number): void => {
      if (controller.signal.aborted || finished) {
        return;
      }
      const ms = Math.max(1, Math.min(timeoutMsFromStart, this.maxTimeoutMs));
      const candidate = store.startedAt + ms;
      store.deadlineAt = Math.min(store.deadlineAt, candidate);
      armTimerForDeadline();
    };

    const setReason = (reason: RequestDeadlineAbortReason): void => {
      store.reason = reason;
    };

    const internals: RequestDeadlineInternals = {
      clearTimer: () => {
        clearTimer();
        store.deadlineAt = store.startedAt + this.maxTimeoutMs;
      },
      rescheduleFromStart,
      setReason,
      abort,
    };

    if (timeoutMs !== undefined) {
      armTimerForDeadline();
    }

    const onClientClose = (): void => {
      if (finished) {
        return;
      }
      if (res.raw?.writableEnded) {
        return;
      }
      abort('client_disconnected');
    };

    const onFinish = (): void => {
      finished = true;
      clearTimer();
      const raw = req.raw;
      if (raw?.off) {
        raw.off('close', onClientClose);
      } else if (raw?.removeListener) {
        raw.removeListener('close', onClientClose);
      }
      if (res.off) {
        res.off('finish', onFinish);
      } else if (res.removeListener) {
        res.removeListener('finish', onFinish);
      }
    };

    req.raw?.on?.('close', onClientClose);
    res.on?.('finish', onFinish);

    if (typeof res.setHeader === 'function') {
      res.setHeader('x-request-deadline', String(store.deadlineAt));
    }

    DeadlineContext.run(store, internals, () => next());
  }
}
