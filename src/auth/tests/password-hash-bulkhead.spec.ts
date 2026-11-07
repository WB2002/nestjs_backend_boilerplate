import { ConfigService } from '@nestjs/config';
import { PasswordHashBulkhead } from '../password/password-hash-bulkhead';
import { OverloadRejectedError } from '@/core/overload';
import { DeadlineContext } from '@/core/request-deadline/context/deadline.context';
import { RequestCancelledError } from '@/core/request-deadline/errors/request-cancelled.error';
import { RequestDeadlineStore } from '@/core/request-deadline/types/request-deadline.types';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const noopInternals = {
  clearTimer: () => undefined,
  rescheduleFromStart: () => undefined,
  setReason: () => undefined,
  abort: () => undefined,
};

describe('PasswordHashBulkhead', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('limits concurrency: maxConcurrent 2 starts only 2 before one resolves', async () => {
    const bulkhead = new PasswordHashBulkhead(undefined, {
      maxConcurrent: 2,
      maxQueue: 10,
      maxWaitMs: 2000,
    });

    let startedCount = 0;
    const d1 = createDeferred();
    const d2 = createDeferred();
    const d3 = createDeferred();

    const p1 = bulkhead.run(async () => {
      startedCount += 1;
      await d1.promise;
      return 'p1';
    });
    const p2 = bulkhead.run(async () => {
      startedCount += 1;
      await d2.promise;
      return 'p2';
    });
    const p3 = bulkhead.run(async () => {
      startedCount += 1;
      await d3.promise;
      return 'p3';
    });

    // Yield to allow synchronous and initial async operations to execute
    await new Promise((resolve) => setImmediate(resolve));
    expect(startedCount).toBe(2);

    d1.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(startedCount).toBe(3);

    d2.resolve();
    d3.resolve();

    const resolvedValues = await Promise.all([p1, p2, p3]);
    expect(resolvedValues).toEqual(['p1', 'p2', 'p3']);
  });

  it('rejects when queue is full: maxConcurrent 1, maxQueue 0 rejects second call', async () => {
    const bulkhead = new PasswordHashBulkhead(undefined, {
      maxConcurrent: 1,
      maxQueue: 0,
      maxWaitMs: 2000,
    });

    const d1 = createDeferred();
    const p1 = bulkhead.run(async () => {
      await d1.promise;
      return 'first';
    });

    await expect(
      bulkhead.run(async () => {
        return 'second';
      }),
    ).rejects.toThrow(OverloadRejectedError);

    d1.resolve();
    await expect(p1).resolves.toBe('first');
  });

  it('rejects on wait timeout: maxWaitMs 50 with fake timers', async () => {
    jest.useFakeTimers();
    const bulkhead = new PasswordHashBulkhead(undefined, {
      maxConcurrent: 1,
      maxQueue: 5,
      maxWaitMs: 50,
    });

    const d1 = createDeferred();
    const p1 = bulkhead.run(async () => {
      await d1.promise;
      return 'first';
    });

    const p2 = bulkhead.run(async () => {
      return 'second';
    });

    const assertion = expect(p2).rejects.toThrow(OverloadRejectedError);
    await jest.advanceTimersByTimeAsync(60);
    await assertion;

    d1.resolve();
    await expect(p1).resolves.toBe('first');
  });

  it('releases the slot when fn throws', async () => {
    const bulkhead = new PasswordHashBulkhead(undefined, {
      maxConcurrent: 1,
      maxQueue: 2,
      maxWaitMs: 2000,
    });

    await expect(
      bulkhead.run(async () => {
        throw new Error('argon2 hashing failure');
      }),
    ).rejects.toThrow('argon2 hashing failure');

    // Slot must be available immediately for the next call
    const recoveredValue = await bulkhead.run(async () => 'recovered');
    expect(recoveredValue).toBe('recovered');
  });

  it('propagates request deadline abort when inbound signal aborts', async () => {
    const bulkhead = new PasswordHashBulkhead(undefined, {
      maxConcurrent: 1,
      maxQueue: 5,
      maxWaitMs: 2000,
    });

    const controller = new AbortController();
    const store: RequestDeadlineStore = {
      signal: controller.signal,
      startedAt: Date.now(),
      deadlineAt: Date.now() + 5000,
      reason: 'client_disconnected',
    };

    const d1 = createDeferred();
    const p1 = bulkhead.run(async () => {
      await d1.promise;
      return 'active';
    });

    let queuePromise: Promise<string> | undefined;
    DeadlineContext.run(store, noopInternals, () => {
      queuePromise = bulkhead.run(async () => 'queued');
    });

    expect(queuePromise).toBeDefined();
    controller.abort('client_disconnected');

    await expect(queuePromise).rejects.toThrow(RequestCancelledError);

    d1.resolve();
    await expect(p1).resolves.toBe('active');
  });

  it('rejects with timeout when remaining deadline is tighter than maxWaitMs', async () => {
    jest.useFakeTimers();
    const bulkhead = new PasswordHashBulkhead(undefined, {
      maxConcurrent: 1,
      maxQueue: 5,
      maxWaitMs: 5000,
    });

    const store: RequestDeadlineStore = {
      signal: new AbortController().signal,
      startedAt: Date.now(),
      deadlineAt: Date.now() + 40,
    };

    const d1 = createDeferred();
    const p1 = bulkhead.run(async () => {
      await d1.promise;
      return 'first';
    });

    let p2!: Promise<string>;
    DeadlineContext.run(store, noopInternals, () => {
      p2 = bulkhead.run(async () => 'second');
    });

    const assertion = expect(p2).rejects.toThrow(OverloadRejectedError);
    await jest.advanceTimersByTimeAsync(50);
    await assertion;

    d1.resolve();
    await expect(p1).resolves.toBe('first');
  });

  it('rejects immediately when inbound signal is already aborted', async () => {
    const bulkhead = new PasswordHashBulkhead(undefined, {
      maxConcurrent: 1,
      maxQueue: 5,
      maxWaitMs: 2000,
    });

    const controller = new AbortController();
    controller.abort('client_disconnected');

    const store: RequestDeadlineStore = {
      signal: controller.signal,
      startedAt: Date.now(),
      deadlineAt: Date.now() + 5000,
      reason: 'client_disconnected',
    };

    await DeadlineContext.run(store, noopInternals, async () => {
      await expect(bulkhead.run(async () => 'never')).rejects.toThrow(
        RequestCancelledError,
      );
    });
  });

  it('reads config from ConfigService with fallback defaults', () => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'AUTH_PASSWORD_HASH_MAX_CONCURRENT') return '4';
        if (key === 'AUTH_PASSWORD_HASH_MAX_QUEUE') return '16';
        if (key === 'AUTH_PASSWORD_HASH_MAX_WAIT_MS') return '1500';
        return undefined;
      }),
    } as unknown as ConfigService;

    const configured = new PasswordHashBulkhead(configService);
    expect(configured.maxConcurrent).toBe(4);
    expect(configured.maxQueue).toBe(16);
    expect(configured.maxWaitMs).toBe(1500);

    const defaultBulkhead = new PasswordHashBulkhead();
    expect(defaultBulkhead.maxConcurrent).toBe(2);
    expect(defaultBulkhead.maxQueue).toBe(32);
    expect(defaultBulkhead.maxWaitMs).toBe(2000);
  });
});
