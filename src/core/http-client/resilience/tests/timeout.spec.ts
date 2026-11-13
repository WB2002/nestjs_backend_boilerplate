import { RequestAbortedError, TimeoutError } from '../../errors';
import {
  createTimeoutBudget,
  remainingTotalMs,
  resolveAttemptTimeoutMs,
  sleep,
  sleepWithinBudget,
} from '../timeout';

describe('timeout resilience helpers', () => {
  describe('createTimeoutBudget', () => {
    it('creates empty budget when no options provided', () => {
      const budget = createTimeoutBudget({});
      expect(budget.attemptTimeoutMs).toBeUndefined();
      expect(budget.totalDeadlineAt).toBeUndefined();
    });

    it('sets attemptTimeoutMs and totalDeadlineAt with current time offset', () => {
      const referenceTime = 1_000_000;
      const budget = createTimeoutBudget({
        timeoutMs: 500,
        totalTimeoutMs: 2_000,
        now: referenceTime,
      });
      expect(budget.attemptTimeoutMs).toBe(500);
      expect(budget.totalDeadlineAt).toBe(1_002_000);
    });
  });

  describe('remainingTotalMs', () => {
    it('returns undefined when no totalDeadlineAt is set', () => {
      expect(remainingTotalMs({})).toBeUndefined();
    });

    it('returns positive remaining ms before deadline', () => {
      const budget = { totalDeadlineAt: 10_000 };
      expect(remainingTotalMs(budget, 8_000)).toBe(2_000);
    });

    it('returns 0 when now equals or exceeds deadline', () => {
      const budget = { totalDeadlineAt: 10_000 };
      expect(remainingTotalMs(budget, 10_000)).toBe(0);
      expect(remainingTotalMs(budget, 12_000)).toBe(0);
    });
  });

  describe('resolveAttemptTimeoutMs', () => {
    it('throws TimeoutError when remaining total time is 0', () => {
      const budget = { totalDeadlineAt: 1_000 };
      expect(() => resolveAttemptTimeoutMs(budget, 1_000)).toThrow(
        TimeoutError,
      );
    });

    it('returns attemptTimeoutMs when remaining is null', () => {
      const budget = { attemptTimeoutMs: 250 };
      expect(resolveAttemptTimeoutMs(budget, 500)).toBe(250);
    });

    it('returns minimum of attemptTimeoutMs and remaining total time', () => {
      const budget = { attemptTimeoutMs: 500, totalDeadlineAt: 1_200 };
      expect(resolveAttemptTimeoutMs(budget, 1_000)).toBe(200);

      const budget2 = { attemptTimeoutMs: 100, totalDeadlineAt: 2_000 };
      expect(resolveAttemptTimeoutMs(budget2, 1_000)).toBe(100);
    });
  });

  describe('sleep', () => {
    it('resolves immediately when delay is <= 0', async () => {
      await expect(sleep(0)).resolves.toBeUndefined();
      await expect(sleep(-10)).resolves.toBeUndefined();
    });

    it('rejects with RequestAbortedError when signal aborts', async () => {
      const abortController = new AbortController();
      const sleepPromise = sleep(1_000, abortController.signal);
      abortController.abort();
      await expect(sleepPromise).rejects.toBeInstanceOf(RequestAbortedError);
    });
  });

  describe('sleepWithinBudget', () => {
    it('throws TimeoutError when total budget is exhausted before backoff sleep', async () => {
      const budget = createTimeoutBudget({
        totalTimeoutMs: 1,
        now: Date.now() - 10,
      });
      await expect(sleepWithinBudget(100, budget)).rejects.toBeInstanceOf(
        TimeoutError,
      );
    });

    it('resolves cleanly when budget has positive remaining time and delayMs is 0', async () => {
      const budget = createTimeoutBudget({
        totalTimeoutMs: 10_000,
      });
      await expect(sleepWithinBudget(0, budget)).resolves.toBeUndefined();
    });

    it('resolves cleanly when budget has positive remaining time and delayMs is negative', async () => {
      const budget = createTimeoutBudget({
        totalTimeoutMs: 10_000,
      });
      await expect(sleepWithinBudget(-5, budget)).resolves.toBeUndefined();
    });

    it('resolves cleanly when no total budget is configured and delayMs is 0', async () => {
      const budget = createTimeoutBudget({});
      await expect(sleepWithinBudget(0, budget)).resolves.toBeUndefined();
    });

    it('sleeps for delayMs when budget has sufficient remaining time', async () => {
      const budget = createTimeoutBudget({
        totalTimeoutMs: 10_000,
      });
      await expect(sleepWithinBudget(5, budget)).resolves.toBeUndefined();
    });
  });
});
