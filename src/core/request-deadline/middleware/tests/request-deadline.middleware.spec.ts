import { RequestDeadlineMiddleware } from '../request-deadline.middleware';
import { DeadlineContext } from '../../context/deadline.context';
import {
  getRequestSignal,
  getDeadlineAt,
} from '../../helpers/request-deadline.helpers';

function createReqRes() {
  const closeListeners: Array<(...args: unknown[]) => void> = [];
  const finishListeners: Array<(...args: unknown[]) => void> = [];

  const req = {
    headers: {} as Record<string, unknown>,
    raw: {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'close') closeListeners.push(listener);
      },
      off: (event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'close') {
          const i = closeListeners.indexOf(listener);
          if (i >= 0) closeListeners.splice(i, 1);
        }
      },
    },
  };

  const res = {
    headers: {} as Record<string, string | number>,
    setHeader: (name: string, value: string | number) => {
      res.headers[name] = value;
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'finish') finishListeners.push(listener);
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'finish') {
        const i = finishListeners.indexOf(listener);
        if (i >= 0) finishListeners.splice(i, 1);
      }
    },
    raw: { writableEnded: false, destroyed: false },
  };

  return { req, res, closeListeners, finishListeners };
}

describe('RequestDeadlineMiddleware', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs ALS with signal and aborts on timer', () => {
    const mw = new RequestDeadlineMiddleware({
      defaultTimeoutMs: 1000,
      maxTimeoutMs: 5000,
    });
    const { req, res } = createReqRes();
    let signal: AbortSignal | undefined;

    mw.use(req, res, () => {
      signal = getRequestSignal();
      expect(signal?.aborted).toBe(false);
      expect(getDeadlineAt()).toBeGreaterThan(Date.now());
    });

    expect(signal).toBeDefined();
    jest.advanceTimersByTime(1000);
    expect(signal!.aborted).toBe(true);
    expect(DeadlineContext.getInternals(signal)?.abort).toBeDefined();
  });

  it('honors x-request-timeout-ms header clamped by max', () => {
    const mw = new RequestDeadlineMiddleware({
      defaultTimeoutMs: 30_000,
      maxTimeoutMs: 2_000,
    });
    const { req, res } = createReqRes();
    req.headers['x-request-timeout-ms'] = '99999';
    let signal: AbortSignal | undefined;

    mw.use(req, res, () => {
      signal = getRequestSignal();
    });

    jest.advanceTimersByTime(1999);
    expect(signal!.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(signal!.aborted).toBe(true);
  });

  it('aborts on client disconnect before response finishes', () => {
    const mw = new RequestDeadlineMiddleware({
      defaultTimeoutMs: 60_000,
      maxTimeoutMs: 120_000,
    });
    const { req, res, closeListeners } = createReqRes();
    let signal: AbortSignal | undefined;

    mw.use(req, res, () => {
      signal = getRequestSignal();
    });

    expect(closeListeners).toHaveLength(1);
    closeListeners[0]!();
    expect(signal!.aborted).toBe(true);
  });

  it('cleans up timer on response finish', () => {
    const mw = new RequestDeadlineMiddleware({
      defaultTimeoutMs: 1000,
      maxTimeoutMs: 5000,
    });
    const { req, res, finishListeners } = createReqRes();
    let signal: AbortSignal | undefined;

    mw.use(req, res, () => {
      signal = getRequestSignal();
    });

    finishListeners[0]!();
    jest.advanceTimersByTime(5000);
    expect(signal!.aborted).toBe(false);
  });

  it('sets x-request-deadline response header', () => {
    const mw = new RequestDeadlineMiddleware({
      defaultTimeoutMs: 1000,
      maxTimeoutMs: 5000,
    });
    const { req, res } = createReqRes();

    mw.use(req, res, () => undefined);

    expect(res.headers['x-request-deadline']).toBeDefined();
  });
});
