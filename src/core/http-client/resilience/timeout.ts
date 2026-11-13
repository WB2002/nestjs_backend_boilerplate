import { RequestAbortedError, TimeoutError } from '../errors';

export interface TimeoutBudget {
  totalDeadlineAt?: number;
  attemptTimeoutMs?: number;
}

export function createTimeoutBudget(options: {
  timeoutMs?: number;
  totalTimeoutMs?: number;
  now?: number;
}): TimeoutBudget {
  const now = options.now ?? Date.now();
  const budget: TimeoutBudget = {};
  if (options.timeoutMs != null) {
    budget.attemptTimeoutMs = options.timeoutMs;
  }
  if (options.totalTimeoutMs != null) {
    budget.totalDeadlineAt = now + options.totalTimeoutMs;
  }
  return budget;
}

export function remainingTotalMs(
  budget: TimeoutBudget,
  now = Date.now(),
): number | undefined {
  if (budget.totalDeadlineAt == null) {
    return undefined;
  }
  return Math.max(0, budget.totalDeadlineAt - now);
}

export function resolveAttemptTimeoutMs(
  budget: TimeoutBudget,
  now = Date.now(),
): number | undefined {
  const remaining = remainingTotalMs(budget, now);
  if (remaining === 0) {
    throw new TimeoutError('Total request timeout exceeded');
  }
  if (budget.attemptTimeoutMs == null) {
    return remaining;
  }
  if (remaining == null) {
    return budget.attemptTimeoutMs;
  }
  return Math.min(budget.attemptTimeoutMs, remaining);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new RequestAbortedError('Sleep aborted', {
          ...(signal.reason !== undefined ? { cause: signal.reason } : {}),
        }),
      );
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new RequestAbortedError('Sleep aborted', {
          ...(signal?.reason !== undefined ? { cause: signal.reason } : {}),
        }),
      );
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Sleep capped by remaining total timeout budget; throws TimeoutError if budget exhausted. */
export async function sleepWithinBudget(
  delayMs: number,
  budget: TimeoutBudget,
  signal?: AbortSignal,
): Promise<void> {
  const remaining = remainingTotalMs(budget);
  if (remaining === 0) {
    throw new TimeoutError('Total request timeout exceeded');
  }
  const waitMs = remaining == null ? delayMs : Math.min(delayMs, remaining);
  if (waitMs > 0) {
    await sleep(waitMs, signal);
  }
  if (remainingTotalMs(budget) === 0) {
    throw new TimeoutError('Total request timeout exceeded');
  }
}
