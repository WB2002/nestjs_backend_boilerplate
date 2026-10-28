import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { DeadlineContext } from '../context/deadline.context';
import { RequestCancelledError } from '../errors/request-cancelled.error';
import {
  REQUEST_TIMEOUT_KEY,
  SKIP_REQUEST_DEADLINE_KEY,
} from '../constants/request-deadline.constants';
import { RequestDeadlineInterceptor } from './request-deadline.interceptor';
import { RequestDeadlineStore } from '../types/request-deadline.types';

function mockContext(headers: Record<string, unknown> = {}): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class Test {},
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
      getResponse: () => ({ setHeader: () => undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('RequestDeadlineInterceptor', () => {
  it('maps client_disconnected via store.reason outside ALS', async () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const interceptor = new RequestDeadlineInterceptor(reflector, {
      defaultTimeoutMs: 30_000,
      maxTimeoutMs: 120_000,
    });

    const controller = new AbortController();
    const startedAt = Date.now();
    const store: RequestDeadlineStore = {
      signal: controller.signal,
      startedAt,
      deadlineAt: startedAt + 30_000,
    };
    const internals = {
      clearTimer: () => undefined,
      rescheduleFromStart: () => undefined,
      setReason: () => undefined,
      abort: () => undefined,
    };

    const next: CallHandler = {
      handle: () =>
        new Observable(() => {
          queueMicrotask(() => {
            store.reason = 'client_disconnected';
            controller.abort('client_disconnected');
          });
        }),
    };

    await new Promise<void>((resolve, reject) => {
      DeadlineContext.run(store, internals, () => {
        interceptor.intercept(mockContext(), next).subscribe({
          error: (err) => {
            try {
              expect(err).toBeInstanceOf(RequestCancelledError);
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        });
      });
    });
  });

  it('does not extend deadline when applying the same budget after delay', () => {
    const startedAt = Date.now() - 50;
    const prevDeadline = startedAt + 1000;
    const store = {
      signal: new AbortController().signal,
      startedAt,
      deadlineAt: prevDeadline,
    };
    const internals = {
      clearTimer: () => undefined,
      rescheduleFromStart: (timeoutMsFromStart: number) => {
        const candidate = store.startedAt + timeoutMsFromStart;
        store.deadlineAt = Math.min(store.deadlineAt, candidate);
      },
      setReason: () => undefined,
      abort: () => undefined,
    };

    const reflector = {
      getAllAndOverride: (key: string) =>
        key === REQUEST_TIMEOUT_KEY ? undefined : undefined,
    } as unknown as Reflector;
    const interceptor = new RequestDeadlineInterceptor(reflector, {
      defaultTimeoutMs: 1000,
      maxTimeoutMs: 5000,
    });

    DeadlineContext.run(store, internals, () => {
      interceptor
        .intercept(mockContext(), { handle: () => of('ok') })
        .subscribe();
    });

    expect(store.deadlineAt).toBeLessThanOrEqual(prevDeadline);
  });

  it('clears timer when SkipRequestDeadline is set', () => {
    let cleared = false;
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === SKIP_REQUEST_DEADLINE_KEY ? true : undefined,
    } as unknown as Reflector;
    const interceptor = new RequestDeadlineInterceptor(reflector, {
      defaultTimeoutMs: 1000,
      maxTimeoutMs: 5000,
    });
    const startedAt = Date.now();
    const store = {
      signal: new AbortController().signal,
      startedAt,
      deadlineAt: startedAt + 1000,
    };
    const internals = {
      clearTimer: () => {
        cleared = true;
      },
      rescheduleFromStart: () => undefined,
      setReason: () => undefined,
      abort: () => undefined,
    };

    DeadlineContext.run(store, internals, () => {
      interceptor
        .intercept(mockContext(), { handle: () => of('ok') })
        .subscribe();
    });
    expect(cleared).toBe(true);
  });
});
