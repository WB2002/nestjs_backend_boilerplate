import { RateLimitAlgorithm } from '../enums/rate-limit-algorithm.enum';
import { ConsumeContext, ConsumeResult } from '../types/rate-limit.types';
import { RateLimitBackend } from '../types/rate-limit-backend.interface';

export type ScenarioExpectation = Partial<ConsumeResult> &
  Pick<ConsumeResult, 'allowed'>;

export interface ScenarioStep {
  /** Fields merged onto the scenario defaults for this consume. */
  input: Partial<
    Pick<ConsumeContext, 'limit' | 'durationMs' | 'cost' | 'nowMs' | 'burst'>
  > &
    Pick<ConsumeContext, 'nowMs'>;
  expected: ScenarioExpectation;
}

export interface AlgorithmScenario {
  name: string;
  algorithm: RateLimitAlgorithm;
  defaults: Pick<ConsumeContext, 'limit' | 'durationMs' | 'cost'> & {
    burst?: number;
  };
  steps: ScenarioStep[];
}

export function expectResult(
  actual: ConsumeResult,
  expected: ScenarioExpectation,
  tolMs = 1,
): void {
  expect(actual.allowed).toBe(expected.allowed);
  if (expected.remaining !== undefined) {
    expect(actual.remaining).toBe(expected.remaining);
  }
  if (expected.resetMs !== undefined) {
    expect(Math.abs(actual.resetMs - expected.resetMs)).toBeLessThanOrEqual(
      tolMs,
    );
  }
  if (expected.retryAfterMs !== undefined) {
    expect(
      Math.abs(actual.retryAfterMs - expected.retryAfterMs),
    ).toBeLessThanOrEqual(tolMs);
  }
}

export function buildConsumeContext(
  scenario: AlgorithmScenario,
  step: ScenarioStep,
  key: string,
): ConsumeContext {
  const burst = step.input.burst ?? scenario.defaults.burst;
  return {
    algorithm: scenario.algorithm,
    key,
    limit: step.input.limit ?? scenario.defaults.limit,
    durationMs: step.input.durationMs ?? scenario.defaults.durationMs,
    cost: step.input.cost ?? scenario.defaults.cost,
    nowMs: step.input.nowMs,
    ...(burst !== undefined ? { burst } : {}),
  };
}

/** Runs a scenario against a backend and asserts each step's expected result. */
export async function runScenario(
  backend: RateLimitBackend,
  scenario: AlgorithmScenario,
  key: string,
  tolMs = 1,
): Promise<void> {
  for (const step of scenario.steps) {
    const result = await backend.consume(
      buildConsumeContext(scenario, step, key),
    );
    expectResult(result, step.expected, tolMs);
    if (
      step.expected.allowed === false &&
      step.expected.retryAfterMs === undefined
    ) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  }
}

/** Runs the same consume sequence on two backends; asserts step results match. */
export async function runParityScenario(
  left: RateLimitBackend,
  right: RateLimitBackend,
  scenario: AlgorithmScenario,
  leftKey: string,
  rightKey: string,
  tolMs = 1,
): Promise<void> {
  for (const step of scenario.steps) {
    const leftResult = await left.consume(
      buildConsumeContext(scenario, step, leftKey),
    );
    const rightResult = await right.consume(
      buildConsumeContext(scenario, step, rightKey),
    );
    expect(leftResult.allowed).toBe(rightResult.allowed);
    expect(leftResult.remaining).toBe(rightResult.remaining);
    expect(
      Math.abs(leftResult.resetMs - rightResult.resetMs),
    ).toBeLessThanOrEqual(tolMs);
    expect(
      Math.abs(leftResult.retryAfterMs - rightResult.retryAfterMs),
    ).toBeLessThanOrEqual(tolMs);
  }
}

export const ALL_ALGORITHMS: RateLimitAlgorithm[] = [
  RateLimitAlgorithm.FixedWindowCounter,
  RateLimitAlgorithm.TokenBucket,
  RateLimitAlgorithm.LeakyBucket,
  RateLimitAlgorithm.SlidingWindowLog,
  RateLimitAlgorithm.SlidingWindowCounter,
  RateLimitAlgorithm.ExponentialWeightedMovingAverage,
];

/** Allow up to limit then deny — shared smoke with remaining assertions. */
export function allowThenDenyScenarios(): AlgorithmScenario[] {
  const nowMs = 1_000_000;
  return ALL_ALGORITHMS.map((algorithm) => ({
    name: `${algorithm}-allow-then-deny`,
    algorithm,
    defaults: { limit: 3, durationMs: 60_000, cost: 1 },
    steps: [
      {
        input: { nowMs },
        expected: { allowed: true, remaining: 2, retryAfterMs: 0 },
      },
      {
        input: { nowMs },
        expected: { allowed: true, remaining: 1, retryAfterMs: 0 },
      },
      {
        input: { nowMs },
        expected: { allowed: true, remaining: 0, retryAfterMs: 0 },
      },
      {
        input: { nowMs },
        expected: { allowed: false, remaining: 0 },
      },
      {
        // deny must not mutate remaining budget
        input: { nowMs },
        expected: { allowed: false, remaining: 0 },
      },
    ],
  }));
}

export const TOKEN_BUCKET_SCENARIOS: AlgorithmScenario[] = [
  {
    name: 'token-bucket-burst-and-cost',
    algorithm: RateLimitAlgorithm.TokenBucket,
    defaults: { limit: 10, durationMs: 60_000, cost: 15, burst: 20 },
    steps: [
      {
        input: { nowMs: 1_000_000 },
        expected: {
          allowed: true,
          remaining: 5,
          retryAfterMs: 0,
          // capacity 20, tokens 5 → refill (15) / (10/60000) = 90000
          resetMs: 90_000,
        },
      },
      {
        // same nowMs so expectations are exact (no partial refill)
        input: { nowMs: 1_000_000 },
        expected: {
          allowed: false,
          remaining: 5,
          retryAfterMs: 60_000,
          resetMs: 90_000,
        },
      },
    ],
  },
  {
    name: 'token-bucket-refill',
    algorithm: RateLimitAlgorithm.TokenBucket,
    defaults: { limit: 10, durationMs: 1_000, cost: 10 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 0,
          retryAfterMs: 0,
          resetMs: 1_000,
        },
      },
      {
        input: { nowMs: 500 },
        expected: {
          allowed: false,
          remaining: 5,
          retryAfterMs: 500,
          resetMs: 500,
        },
      },
      {
        // lastRefillAt=500, tokens=5; at 1000 refill +5 → 10, then spend 10
        input: { nowMs: 1_000 },
        expected: {
          allowed: true,
          remaining: 0,
          retryAfterMs: 0,
          resetMs: 1_000,
        },
      },
    ],
  },
  {
    name: 'token-bucket-cost-exceeds-capacity',
    algorithm: RateLimitAlgorithm.TokenBucket,
    defaults: { limit: 5, durationMs: 1_000, cost: 10, burst: 5 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 5,
          retryAfterMs: 1_000,
          resetMs: 0,
        },
      },
      {
        // deny must not mutate tokens
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 5,
          retryAfterMs: 1_000,
          resetMs: 0,
        },
      },
    ],
  },
];

export const LEAKY_BUCKET_SCENARIOS: AlgorithmScenario[] = [
  {
    name: 'leaky-bucket-fill-then-deny',
    algorithm: RateLimitAlgorithm.LeakyBucket,
    defaults: { limit: 10, durationMs: 1_000, cost: 10 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 0,
          retryAfterMs: 0,
          resetMs: 1_000,
        },
      },
      {
        input: { nowMs: 1 },
        expected: {
          allowed: false,
          remaining: 0,
          // level≈9.99 after 1ms leak; overflow ≈ 9.99; reset ≈ 999
          retryAfterMs: 999,
          resetMs: 999,
        },
      },
    ],
  },
  {
    name: 'leaky-bucket-leak-frees-capacity',
    algorithm: RateLimitAlgorithm.LeakyBucket,
    defaults: { limit: 10, durationMs: 1_000, cost: 5 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 5,
          retryAfterMs: 0,
          resetMs: 500,
        },
      },
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 0,
          retryAfterMs: 0,
          resetMs: 1_000,
        },
      },
      {
        // level=10; cost=5 → overflow 5 → retry 500; reset 1000
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 0,
          retryAfterMs: 500,
          resetMs: 1_000,
        },
      },
      {
        // after 500ms leak, level=5; cost=5 fits
        input: { nowMs: 500 },
        expected: {
          allowed: true,
          remaining: 0,
          retryAfterMs: 0,
          resetMs: 1_000,
        },
      },
    ],
  },
  {
    name: 'leaky-bucket-retry-differs-from-reset',
    algorithm: RateLimitAlgorithm.LeakyBucket,
    defaults: { limit: 10, durationMs: 1_000, cost: 4, burst: 10 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 6,
          resetMs: 400,
          retryAfterMs: 0,
        },
      },
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 2,
          resetMs: 800,
          retryAfterMs: 0,
        },
      },
      {
        // level=8; cost=4 → overflow 2 → retry 200; reset 800
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 2,
          retryAfterMs: 200,
          resetMs: 800,
        },
      },
      {
        // deny must not add to level
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 2,
          retryAfterMs: 200,
          resetMs: 800,
        },
      },
    ],
  },
  {
    name: 'leaky-bucket-cost-exceeds-capacity',
    algorithm: RateLimitAlgorithm.LeakyBucket,
    defaults: { limit: 5, durationMs: 1_000, cost: 10, burst: 5 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 5,
          retryAfterMs: 1_000,
          resetMs: 0,
        },
      },
      {
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 5,
          retryAfterMs: 1_000,
          resetMs: 0,
        },
      },
    ],
  },
];

export const FIXED_WINDOW_SCENARIOS: AlgorithmScenario[] = [
  {
    name: 'fixed-window-boundary',
    algorithm: RateLimitAlgorithm.FixedWindowCounter,
    defaults: { limit: 1, durationMs: 1_000, cost: 1 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 0,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
      {
        input: { nowMs: 500 },
        expected: {
          allowed: false,
          remaining: 0,
          resetMs: 500,
          retryAfterMs: 500,
        },
      },
      {
        input: { nowMs: 1_000 },
        expected: {
          allowed: true,
          remaining: 0,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
    ],
  },
  {
    name: 'fixed-window-cost-exceeds-limit',
    algorithm: RateLimitAlgorithm.FixedWindowCounter,
    defaults: { limit: 3, durationMs: 1_000, cost: 5 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 3,
          resetMs: 1_000,
          retryAfterMs: 1_000,
        },
      },
      {
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 3,
          resetMs: 1_000,
          retryAfterMs: 1_000,
        },
      },
    ],
  },
  {
    name: 'fixed-window-exact-limit',
    algorithm: RateLimitAlgorithm.FixedWindowCounter,
    defaults: { limit: 2, durationMs: 1_000, cost: 2 },
    steps: [
      {
        // windowStart becomes 100; resetMs = 100 + 1000 - 100 = 1000
        input: { nowMs: 100 },
        expected: {
          allowed: true,
          remaining: 0,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
      {
        // resetMs = 100 + 1000 - 200 = 900
        input: { nowMs: 200 },
        expected: {
          allowed: false,
          remaining: 0,
          resetMs: 900,
          retryAfterMs: 900,
        },
      },
    ],
  },
];

export const SLIDING_LOG_SCENARIOS: AlgorithmScenario[] = [
  {
    name: 'sliding-log-variable-cost',
    algorithm: RateLimitAlgorithm.SlidingWindowLog,
    defaults: { limit: 3, durationMs: 1_000, cost: 2 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 1,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
      {
        input: { nowMs: 1 },
        expected: {
          allowed: false,
          remaining: 1,
          resetMs: 999,
          retryAfterMs: 999,
        },
      },
      {
        // cost=1 fits remaining
        input: { nowMs: 1, cost: 1 },
        expected: {
          allowed: true,
          remaining: 0,
          resetMs: 999,
          retryAfterMs: 0,
        },
      },
    ],
  },
  {
    name: 'sliding-log-cost-exceeds-limit-empty',
    algorithm: RateLimitAlgorithm.SlidingWindowLog,
    defaults: { limit: 3, durationMs: 5_000, cost: 10 },
    steps: [
      {
        input: { nowMs: 100 },
        expected: {
          allowed: false,
          remaining: 3,
          resetMs: 5_000,
          retryAfterMs: 5_000,
        },
      },
    ],
  },
  {
    name: 'sliding-log-oldest-ages-out',
    algorithm: RateLimitAlgorithm.SlidingWindowLog,
    defaults: { limit: 1, durationMs: 1_000, cost: 1 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 0,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
      {
        input: { nowMs: 500 },
        expected: {
          allowed: false,
          remaining: 0,
          resetMs: 500,
          retryAfterMs: 500,
        },
      },
      {
        // entry at 0 ages out when cutoff = 1000 - 1000 = 0 (ts > cutoff → 0 > 0 false)
        input: { nowMs: 1_000 },
        expected: {
          allowed: true,
          remaining: 0,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
    ],
  },
];

export const SLIDING_COUNTER_SCENARIOS: AlgorithmScenario[] = [
  {
    name: 'sliding-counter-weight-blend-denies',
    algorithm: RateLimitAlgorithm.SlidingWindowCounter,
    defaults: { limit: 3, durationMs: 1_000, cost: 1 },
    steps: [
      { input: { nowMs: 0 }, expected: { allowed: true, remaining: 2 } },
      { input: { nowMs: 1 }, expected: { allowed: true, remaining: 1 } },
      { input: { nowMs: 2 }, expected: { allowed: true, remaining: 0 } },
      {
        // new window at 1000; weight=1; estimate=3 → deny
        input: { nowMs: 1_000 },
        expected: {
          allowed: false,
          remaining: 0,
          resetMs: 1_000,
          retryAfterMs: 1_000,
        },
      },
      {
        // weight=0.5; estimate=1.5; +1 ok; newEstimate=2.5; remaining=floor(0.5)=0
        input: { nowMs: 1_500 },
        expected: {
          allowed: true,
          remaining: 0,
          resetMs: 500,
          retryAfterMs: 0,
        },
      },
    ],
  },
  {
    name: 'sliding-counter-hard-reset-after-idle',
    algorithm: RateLimitAlgorithm.SlidingWindowCounter,
    defaults: { limit: 2, durationMs: 1_000, cost: 1 },
    steps: [
      { input: { nowMs: 0 }, expected: { allowed: true, remaining: 1 } },
      { input: { nowMs: 1 }, expected: { allowed: true, remaining: 0 } },
      {
        // After windowStart=0, advancing past start+2*duration triggers hard reset.
        // At nowMs=3000 the loop rolls then hard-resets (~3*duration from t=0).
        input: { nowMs: 3_000 },
        expected: {
          allowed: true,
          remaining: 1,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
    ],
  },
  {
    name: 'sliding-counter-cost-exceeds-limit',
    algorithm: RateLimitAlgorithm.SlidingWindowCounter,
    defaults: { limit: 3, durationMs: 1_000, cost: 5 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 3,
          resetMs: 1_000,
          retryAfterMs: 1_000,
        },
      },
      {
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 3,
          resetMs: 1_000,
          retryAfterMs: 1_000,
        },
      },
    ],
  },
];

export const EWMA_SCENARIOS: AlgorithmScenario[] = [
  {
    name: 'ewma-burst-then-deny-with-retry',
    algorithm: RateLimitAlgorithm.ExponentialWeightedMovingAverage,
    defaults: { limit: 3, durationMs: 1_000, cost: 1 },
    steps: [
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 2,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 1,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
      {
        input: { nowMs: 0 },
        expected: {
          allowed: true,
          remaining: 0,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
      {
        // ewma=3; target=(3-1)/3=2/3; ceil(-1000*ln(2/3))=406
        input: { nowMs: 0 },
        expected: {
          allowed: false,
          remaining: 0,
          retryAfterMs: 406,
          resetMs: 406,
        },
      },
      {
        // lastAt updated on deny; after 406ms decay allows
        input: { nowMs: 406 },
        expected: {
          allowed: true,
          remaining: 0,
          resetMs: 1_000,
          retryAfterMs: 0,
        },
      },
    ],
  },
  {
    name: 'ewma-cost-exceeds-limit',
    algorithm: RateLimitAlgorithm.ExponentialWeightedMovingAverage,
    defaults: { limit: 3, durationMs: 2_000, cost: 5 },
    steps: [
      {
        input: { nowMs: 50 },
        expected: {
          allowed: false,
          remaining: 3,
          retryAfterMs: 2_000,
          resetMs: 2_000,
        },
      },
      {
        // deny updates lastAt but not ewma; second deny same remaining
        input: { nowMs: 50 },
        expected: {
          allowed: false,
          remaining: 3,
          retryAfterMs: 2_000,
          resetMs: 2_000,
        },
      },
    ],
  },
];

/** All correctness scenarios (excludes the generic allow-then-deny smoke list). */
export function allCorrectnessScenarios(): AlgorithmScenario[] {
  return [
    ...TOKEN_BUCKET_SCENARIOS,
    ...LEAKY_BUCKET_SCENARIOS,
    ...FIXED_WINDOW_SCENARIOS,
    ...SLIDING_LOG_SCENARIOS,
    ...SLIDING_COUNTER_SCENARIOS,
    ...EWMA_SCENARIOS,
  ];
}

/** Smoke + correctness — used by redis + parity suites. */
export function allSharedScenarios(): AlgorithmScenario[] {
  return [...allowThenDenyScenarios(), ...allCorrectnessScenarios()];
}
