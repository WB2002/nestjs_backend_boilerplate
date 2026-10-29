import { DeadlineContext } from '../../context/deadline.context';
import { RequestCancelledError } from '../../errors/request-cancelled.error';
import { RequestDeadlineExceededError } from '../../errors/request-deadline-exceeded.error';
import {
  getDeadlineAt,
  getRequestSignal,
  remainingMs,
  throwIfAborted,
} from '../request-deadline.helpers';
import { RequestDeadlineStore } from '../../types/request-deadline.types';

const noopInternals = {
  clearTimer: () => undefined,
  rescheduleFromStart: () => undefined,
  setReason: () => undefined,
  abort: () => undefined,
};

describe('request-deadline helpers', () => {
  it('returns undefined outside of DeadlineContext', () => {
    expect(getRequestSignal()).toBeUndefined();
    expect(getDeadlineAt()).toBeUndefined();
    expect(remainingMs()).toBeUndefined();
    expect(() => throwIfAborted()).not.toThrow();
  });

  it('exposes signal and deadline from context', () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const deadlineAt = startedAt + 10_000;

    DeadlineContext.run(
      { signal: controller.signal, startedAt, deadlineAt },
      noopInternals,
      () => {
        expect(getRequestSignal()).toBe(controller.signal);
        expect(getDeadlineAt()).toBe(deadlineAt);
        expect(remainingMs(deadlineAt - 4_000)).toBe(4_000);
      },
    );
  });

  it('throwIfAborted throws typed errors by reason', () => {
    const controller = new AbortController();
    const store: RequestDeadlineStore = {
      signal: controller.signal,
      startedAt: Date.now(),
      deadlineAt: Date.now(),
      reason: 'timeout',
    };

    DeadlineContext.run(store, noopInternals, () => {
      controller.abort();
      expect(() => throwIfAborted()).toThrow(RequestDeadlineExceededError);

      store.reason = 'client_disconnected';
      expect(() => throwIfAborted()).toThrow(RequestCancelledError);
    });
  });

  it('does not expose AbortController via helpers', () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    DeadlineContext.run(
      {
        signal: controller.signal,
        startedAt,
        deadlineAt: startedAt + 1000,
      },
      noopInternals,
      () => {
        const signal = getRequestSignal();
        expect(signal).toBeDefined();
        expect(
          (signal as AbortSignal & { controller?: unknown }).controller,
        ).toBeUndefined();
      },
    );
  });
});
