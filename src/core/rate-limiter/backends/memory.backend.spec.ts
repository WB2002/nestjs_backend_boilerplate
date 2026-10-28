import { MemoryRateLimitBackend } from './memory.backend';
import { RateLimitAlgorithm } from '../enums/rate-limit-algorithm.enum';
import { ConsumeContext } from '../types/rate-limit.types';
import {
  ALL_ALGORITHMS,
  TOKEN_BUCKET_SCENARIOS,
  LEAKY_BUCKET_SCENARIOS,
  FIXED_WINDOW_SCENARIOS,
  SLIDING_LOG_SCENARIOS,
  SLIDING_COUNTER_SCENARIOS,
  EWMA_SCENARIOS,
  allowThenDenyScenarios,
  runScenario,
} from './algorithm-scenarios';

function baseCtx(
  overrides: Partial<ConsumeContext> &
    Pick<ConsumeContext, 'algorithm' | 'key'>,
): ConsumeContext {
  return {
    limit: 3,
    durationMs: 60_000,
    cost: 1,
    nowMs: 1_000_000,
    ...overrides,
  };
}

describe('MemoryRateLimitBackend', () => {
  let backend: MemoryRateLimitBackend;

  beforeEach(() => {
    backend = new MemoryRateLimitBackend(100);
  });

  describe('allow up to limit then deny (all algorithms)', () => {
    it.each(allowThenDenyScenarios())('$name', async (scenario) => {
      await runScenario(backend, scenario, `mem-${scenario.name}`);
    });
  });

  describe('TokenBucket', () => {
    it.each(TOKEN_BUCKET_SCENARIOS)('$name', async (scenario) => {
      await runScenario(backend, scenario, `mem-${scenario.name}`);
    });
  });

  describe('LeakyBucket', () => {
    it.each(LEAKY_BUCKET_SCENARIOS)('$name', async (scenario) => {
      await runScenario(backend, scenario, `mem-${scenario.name}`);
    });
  });

  describe('FixedWindowCounter', () => {
    it.each(FIXED_WINDOW_SCENARIOS)('$name', async (scenario) => {
      await runScenario(backend, scenario, `mem-${scenario.name}`);
    });
  });

  describe('SlidingWindowLog', () => {
    it.each(SLIDING_LOG_SCENARIOS)('$name', async (scenario) => {
      await runScenario(backend, scenario, `mem-${scenario.name}`);
    });
  });

  describe('SlidingWindowCounter', () => {
    it.each(SLIDING_COUNTER_SCENARIOS)('$name', async (scenario) => {
      await runScenario(backend, scenario, `mem-${scenario.name}`);
    });
  });

  describe('ExponentialWeightedMovingAverage', () => {
    it.each(EWMA_SCENARIOS)('$name', async (scenario) => {
      await runScenario(backend, scenario, `mem-${scenario.name}`);
    });
  });

  it('deny does not mutate budget (TokenBucket)', async () => {
    const key = 'deny-no-mutate';
    const denied = await backend.consume(
      baseCtx({
        algorithm: RateLimitAlgorithm.TokenBucket,
        key,
        limit: 5,
        burst: 5,
        cost: 10,
        nowMs: 0,
        durationMs: 1_000,
      }),
    );
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(5);

    const again = await backend.consume(
      baseCtx({
        algorithm: RateLimitAlgorithm.TokenBucket,
        key,
        limit: 5,
        burst: 5,
        cost: 10,
        nowMs: 0,
        durationMs: 1_000,
      }),
    );
    expect(again.allowed).toBe(false);
    expect(again.remaining).toBe(5);
  });

  it('uses nowMs deterministically for fixed window reset', async () => {
    const key = 'fw';
    await backend.consume(
      baseCtx({
        algorithm: RateLimitAlgorithm.FixedWindowCounter,
        key,
        nowMs: 0,
        limit: 1,
        durationMs: 1000,
      }),
    );
    const denied = await backend.consume(
      baseCtx({
        algorithm: RateLimitAlgorithm.FixedWindowCounter,
        key,
        nowMs: 500,
        limit: 1,
        durationMs: 1000,
      }),
    );
    expect(denied.allowed).toBe(false);
    expect(denied.resetMs).toBe(500);

    const nextWindow = await backend.consume(
      baseCtx({
        algorithm: RateLimitAlgorithm.FixedWindowCounter,
        key,
        nowMs: 1000,
        limit: 1,
        durationMs: 1000,
      }),
    );
    expect(nextWindow.allowed).toBe(true);
  });

  it('evicts expired keys and enforces cap', async () => {
    const small = new MemoryRateLimitBackend(5);
    for (let i = 0; i < 8; i++) {
      await small.consume(
        baseCtx({
          algorithm: RateLimitAlgorithm.FixedWindowCounter,
          key: `cap-${i}`,
          nowMs: 1_000 + i,
          durationMs: 60_000,
        }),
      );
    }
    expect(small.size).toBeLessThanOrEqual(5);

    await small.consume(
      baseCtx({
        algorithm: RateLimitAlgorithm.FixedWindowCounter,
        key: 'expire-me',
        nowMs: 10_000,
        durationMs: 100,
      }),
    );
    await small.consume(
      baseCtx({
        algorithm: RateLimitAlgorithm.FixedWindowCounter,
        key: 'later',
        nowMs: 10_000 + 100 * 2 + 1,
        durationMs: 60_000,
      }),
    );
    expect(small.size).toBeLessThanOrEqual(5);
  });

  it('falls back unknown algorithm to FixedWindowCounter', async () => {
    const key = 'fallback';
    const result = await backend.consume(
      baseCtx({
        algorithm: 'NotARealAlgorithm' as RateLimitAlgorithm,
        key,
        limit: 1,
        nowMs: 0,
        durationMs: 1_000,
      }),
    );
    expect(result.allowed).toBe(true);

    const denied = await backend.consume(
      baseCtx({
        algorithm: 'NotARealAlgorithm' as RateLimitAlgorithm,
        key,
        limit: 1,
        nowMs: 1,
        durationMs: 1_000,
      }),
    );
    expect(denied.allowed).toBe(false);
  });

  it('covers every RateLimitAlgorithm enum value in shared scenarios', () => {
    const covered = new Set(ALL_ALGORITHMS);
    for (const value of Object.values(RateLimitAlgorithm)) {
      expect(covered.has(value)).toBe(true);
    }
  });
});
