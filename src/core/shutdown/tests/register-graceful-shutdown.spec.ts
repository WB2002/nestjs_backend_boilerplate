import { ShutdownState } from '../shutdown-state.service';
import { registerGracefulShutdown } from '../register-graceful-shutdown';

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('registerGracefulShutdown', () => {
  const DRAIN_MS = 100;
  const FORCE_MS = 50;

  let shutdownState: ShutdownState;
  let order: string[];
  let signalHandlers: Map<string, () => void>;
  let exited: Deferred<number>;

  let close: jest.Mock;
  let sleep: jest.Mock;
  let beforeClose: jest.Mock;
  let onExit: jest.Mock;

  beforeEach(() => {
    shutdownState = new ShutdownState();
    order = [];
    signalHandlers = new Map();
    exited = deferred<number>();

    const realBeginShutdown = shutdownState.beginShutdown.bind(shutdownState);
    jest.spyOn(shutdownState, 'beginShutdown').mockImplementation(() => {
      order.push('beginShutdown');
      realBeginShutdown();
    });

    sleep = jest.fn(async (ms: number) => {
      order.push(`sleep:${ms}`);
    });
    beforeClose = jest.fn(async () => {
      order.push('beforeClose');
    });
    close = jest.fn(async () => {
      order.push('close');
    });
    onExit = jest.fn((code: number) => {
      order.push(`exit:${code}`);
      exited.resolve(code);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function register() {
    registerGracefulShutdown({ close }, shutdownState, {
      drainMs: DRAIN_MS,
      forceMs: FORCE_MS,
      sleep,
      beforeClose,
      onExit,
      onSignal: (signal, listener) => {
        signalHandlers.set(signal, listener);
      },
    });
  }

  it('marks not ready, drains, aborts deps, closes, then exits 0', async () => {
    register();

    signalHandlers.get('SIGTERM')!();

    await expect(exited.promise).resolves.toBe(0);
    expect(order).toEqual([
      'beginShutdown',
      `sleep:${DRAIN_MS}`,
      'beforeClose',
      'close',
      'exit:0',
    ]);
  });

  it('ignores duplicate signals while already shutting down', async () => {
    const draining = deferred();
    sleep.mockImplementation(async () => {
      order.push('sleep');
      await draining.promise;
    });

    register();

    signalHandlers.get('SIGTERM')!();
    signalHandlers.get('SIGINT')!();
    signalHandlers.get('SIGTERM')!();

    // Only the first signal started the sequence.
    expect(sleep).toHaveBeenCalledTimes(1);

    draining.resolve();
    await expect(exited.promise).resolves.toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('force-exits with code 1 when close hangs past drain + force', async () => {
    jest.useFakeTimers();
    const closeStarted = deferred();
    close.mockImplementation(() => {
      order.push('close');
      closeStarted.resolve();
      return new Promise(() => {}); // never settles
    });

    register();
    signalHandlers.get('SIGTERM')!();

    await closeStarted.promise;
    expect(onExit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(DRAIN_MS + FORCE_MS);

    expect(onExit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when close rejects', async () => {
    close.mockRejectedValue(new Error('close failed'));

    register();
    signalHandlers.get('SIGINT')!();

    await expect(exited.promise).resolves.toBe(1);
  });

  it('exits 1 when beforeClose rejects and never calls close', async () => {
    beforeClose.mockRejectedValue(new Error('destroy failed'));

    register();
    signalHandlers.get('SIGTERM')!();

    await expect(exited.promise).resolves.toBe(1);
    expect(close).not.toHaveBeenCalled();
  });
});
