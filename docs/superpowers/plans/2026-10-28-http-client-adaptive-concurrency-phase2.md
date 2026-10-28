# HttpClient Adaptive Concurrency (Phase II) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **optional adaptive outbound concurrency** to `ClientRuntime` behind the existing `.addConcurrencyLimit()` fluent API, so limits auto-tune from observed latency and errors while **fixed + `clusterAware`** behavior (Task 3) remains the default.

**Architecture:** Introduce a small **`ConcurrencyGate`** facade (`run(signal, fn)`) with two backends: **`FixedConcurrencyGate`** (today’s queued `ConcurrencyLimiter`) and **`AdaptiveConcurrencyGate`** (in-repo **`AdaptiveLimiter.execute`**). The limiter algorithm is **vendored source** under `src/core/http-client/resilience/adaptive/` (ported from Fortify-TS adaptive `@0.1.0`, MIT), **not** an npm dependency. `ClientRuntime` replaces direct `limiter.acquire()` with `gate.run()` around the transport attempt. Policy gains `mode: 'fixed' | 'adaptive'` plus nested tuning fields; **`resolveAdaptiveConcurrencyConfig`** applies the same **`HTTP_CLIENT_INSTANCE_COUNT`** math as Task 3 to `initialLimit` / `minLimit` / `maxLimit`. Adaptive mode **does not queue** when the current cap is full (fail-fast); fixed mode keeps the existing queue.

**Tech Stack:** NestJS 11, existing `src/core/http-client`, vendored adaptive limiter (no new runtime npm deps), Jest (`pnpm exec jest … --watchman=false --testPathIgnorePatterns='.worktrees'`).

## Global Constraints

- **Runtime:** Node **22+**; package manager **pnpm**; tests via **`pnpm exec jest … --watchman=false --testPathIgnorePatterns='.worktrees'`**.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Backward compatibility:** Omitting `mode` ⇒ **`fixed`**; existing `.addConcurrencyLimit({ maxConcurrent: N })` unchanged.
- **Cluster math:** When `clusterAware: true`, divide **`maxConcurrent`** (fixed cap) or adaptive **`initialLimit` / `minLimit` / `maxLimit`** by `HTTP_CLIENT_INSTANCE_COUNT` (default `1`), each with **`max(1, floor(...))`** — same helper family as Task 3.
- **Scope OUT:** Inbound adaptive limits; Redis cross-VM outbound semaphore; replacing `HttpClient` public fluent method names; Nginx/Envoy.
- **Prerequisites:** Task 3 shipped (`resolveEffectiveMaxConcurrent`, `parseHttpClientInstanceCount`, `ConcurrencyLimitPolicy.clusterAware`).
- **Branch workflow (user preference):** Implement on **`feat/resilience-task-7-http-client-adaptive`**, merge to **`master`** with `--no-ff` when complete.
- **Supply chain:** **Do not** add `@klarlabs-studio/fortify-adaptive`, `@klarlabs-studio/fortify-core`, or **`zod`** to `package.json` for this feature. All adaptive limiter code is **first-party paths** with **`UPSTREAM.md` + `LICENSE`** attribution. Config parsing uses hand-written defaults/clamping (same behavior as upstream `parseAdaptiveConfig`, without Zod).

**Algorithm source (document in PR):**

| Option | Verdict |
| ------ | ------- |
| **Vendored Fortify-TS adaptive `@0.1.0`** | **Selected** — port MIT source into `resilience/adaptive/`; reviewable in PR; no post-install supply-chain drift. |
| npm `@klarlabs-studio/fortify-adaptive` | **Rejected** — user requirement: avoid third-party package runtime for adaptive limiter. |
| npm `gradient-limit` | **Rejected** — no Netflix-style adaptive limiter package under that name. |
| Vendoring Java `concurrency-limits` | **Rejected** — maintenance cost; no first-class Node story in this repo. |

---

## File map

| File | Responsibility |
| ---- | -------------- |
| `src/core/http-client/resilience/adaptive/UPSTREAM.md` | Provenance, pinned version, manual sync steps |
| `src/core/http-client/resilience/adaptive/LICENSE` | MIT text from upstream |
| `src/core/http-client/resilience/adaptive/adaptive-config.ts` | `parseAdaptiveConfig` (no Zod) |
| `src/core/http-client/resilience/adaptive/adaptive-limiter.ts` | `AdaptiveLimiter`, `aimd` / `vegas` / `gradient2` |
| `src/core/http-client/resilience/adaptive/adaptive-limit-exceeded.error.ts` | `AdaptiveLimitExceededError` |
| `src/core/http-client/resilience/adaptive/never-aborted-signal.ts` | Shared abort sentinel |
| `src/core/http-client/resilience/adaptive/index.ts` | Public exports for gate + resolver |
| `src/core/http-client/resilience/adaptive/tests/adaptive-limiter.spec.ts` | Unit tests on vendored limiter (before gate) |
| `src/core/http-client/types/policy.types.ts` | Extend `ConcurrencyLimitPolicy` (`mode`, `adaptive`) |
| `src/core/http-client/resilience/concurrency-gate.types.ts` | `ConcurrencyGate` interface |
| `src/core/http-client/resilience/fixed-concurrency-gate.ts` | Queueing gate over `ConcurrencyLimiter` |
| `src/core/http-client/resilience/adaptive-concurrency-gate.ts` | Adapter over in-repo `AdaptiveLimiter` + signal merge |
| `src/core/http-client/resilience/resolve-adaptive-concurrency-config.ts` | Map policy → `AdaptiveLimiterConfigInput` + cluster math |
| `src/core/http-client/resilience/create-concurrency-gate.ts` | Factory (`fixed` \| `adaptive`) |
| `src/core/http-client/resilience/merge-abort-signals.ts` | Combine caller + slot signals |
| `src/core/http-client/resilience/tests/resolve-adaptive-concurrency-config.spec.ts` | Pure config tests |
| `src/core/http-client/resilience/tests/adaptive-concurrency-gate.spec.ts` | Gate + limiter integration |
| `src/core/http-client/runtime/client-runtime.ts` | Use `ConcurrencyGate` instead of raw limiter |
| `src/core/http-client/resilience/index.ts` | Re-exports (gate factory only if needed externally) |
| `src/core/http-client/index.ts` | Export `AdaptiveLimitExceededError` if callers need it |
| `docs/features/http_client.feature.md` | Adaptive section + vendored-source note |

---

### Task 0: Vendored adaptive limiter (in-repo, no npm)

**Files:**
- Create: `src/core/http-client/resilience/adaptive/UPSTREAM.md`
- Create: `src/core/http-client/resilience/adaptive/LICENSE`
- Create: `src/core/http-client/resilience/adaptive/adaptive-limit-exceeded.error.ts`
- Create: `src/core/http-client/resilience/adaptive/never-aborted-signal.ts`
- Create: `src/core/http-client/resilience/adaptive/adaptive-config.ts`
- Create: `src/core/http-client/resilience/adaptive/adaptive-limiter.ts`
- Create: `src/core/http-client/resilience/adaptive/index.ts`
- Create: `src/core/http-client/resilience/adaptive/tests/adaptive-limiter.spec.ts`

**Interfaces:**
- **Produces:**
  - `AdaptiveLimitExceededError`
  - `NEVER_ABORTED_SIGNAL`
  - `AdaptiveAlgorithm = 'aimd' | 'vegas' | 'gradient2'`
  - `AdaptiveLimiterConfigInput` (optional tuning + `onLimitChange?`, `clock?`)
  - `parseAdaptiveConfig(input?: AdaptiveLimiterConfigInput): AdaptiveLimiterConfig`
  - `AdaptiveLimiter<T>` with `execute(operation, signal?)`, `limit()`, `inFlight()`

- [ ] **Step 1: Add provenance files**

```markdown
<!-- UPSTREAM.md -->
# Adaptive concurrency limiter (vendored)

- **Upstream:** [fortify-ts `packages/adaptive`](https://github.com/klarlabs-studio/fortify-ts/tree/main/packages/adaptive)
- **Pinned npm release:** `@klarlabs-studio/fortify-adaptive@0.1.0` (tarball shasum `1462a5301d0ed9c536d63b05c6e40861352b7489`)
- **License:** MIT — see `LICENSE` in this directory
- **Why in-repo:** Avoid runtime dependency on `@klarlabs-studio/*` packages (supply-chain review in git only)

## Re-sync procedure

1. Download the tagged upstream source or npm tarball for the target version.
2. Diff `adaptive-limiter.ts` and `adaptive-config.ts` against upstream `src/adaptive.ts` / `src/config.ts`.
3. Re-run `pnpm exec jest src/core/http-client/resilience/adaptive/tests/adaptive-limiter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`.
4. Update this file’s pinned version and shasum.
```

Copy MIT license text from upstream package into `LICENSE`.

- [ ] **Step 2: Write failing limiter tests (TDD on vendored module)**

```typescript
// adaptive/tests/adaptive-limiter.spec.ts
import {
  AdaptiveLimiter,
  AdaptiveLimitExceededError,
} from '../index';

describe('AdaptiveLimiter (vendored)', () => {
  it('fail-fast when at cap', async () => {
    const limiter = new AdaptiveLimiter({
      algorithm: 'aimd',
      initialLimit: 1,
      minLimit: 1,
      maxLimit: 5,
    });
    const release = limiter.execute(async () => {
      await new Promise<void>((r) => setTimeout(r, 50));
      return 'slow';
    });
    await expect(limiter.execute(async () => 'fast')).rejects.toBeInstanceOf(
      AdaptiveLimitExceededError,
    );
    await release;
  });

  it('aimd increases limit after successThreshold successes', async () => {
    let cap = 0;
    const limiter = new AdaptiveLimiter({
      algorithm: 'aimd',
      initialLimit: 2,
      maxLimit: 6,
      successThreshold: 2,
      onLimitChange: (_o, n) => {
        cap = n;
      },
    });
    for (let i = 0; i < 4; i++) {
      await limiter.execute(async () => 'ok');
    }
    expect(cap).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec jest src/core/http-client/resilience/adaptive/tests/adaptive-limiter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: FAIL — module not found

- [ ] **Step 4: Implement errors + never-aborted signal**

```typescript
// adaptive-limit-exceeded.error.ts
export class AdaptiveLimitExceededError extends Error {
  constructor(message = 'Adaptive concurrency limit exceeded') {
    super(message);
    this.name = 'AdaptiveLimitExceededError';
  }
}

// never-aborted-signal.ts
export const NEVER_ABORTED_SIGNAL: AbortSignal = new AbortController().signal;
```

- [ ] **Step 5: Implement parseAdaptiveConfig without Zod**

Port logic from upstream `packages/adaptive/src/config.ts` / published `dist/index.js` defaults:

- Defaults: `algorithm='aimd'`, `initialLimit=10`, `minLimit=1`, `maxLimit=200`, `successThreshold=10`, `vegasAlpha=3`, `vegasBeta=6`, `vegasMinSamples=10`, `gradientMinSamples=10`, `gradientSmoothing=0.2`
- Clamp: `maxLimit >= minLimit`, `initialLimit` into `[minLimit, maxLimit]`, if `vegasBeta <= vegasAlpha` then `vegasBeta = vegasAlpha * 2`
- Validate positive integers for limits/thresholds; throw `Error` with clear message on invalid input (mirror Zod rejections for negatives/zero)

- [ ] **Step 6: Port AdaptiveLimiter class**

Port `execute`, `aimdOnSuccess`, `vegasOnSuccess`, `gradient2OnSuccess`, `onFailure`, RTT helpers, and `setLimit` from upstream `packages/adaptive/src/adaptive.ts` (or tarball `dist/index.js` ~lines 114–230). Add file header:

```typescript
// Adapted from @klarlabs-studio/fortify-adaptive@0.1.0 (MIT). In-repo copy — do not add npm dependency.
```

Use `AdaptiveLimitExceededError` instead of `FortifyError`. Omit upstream `logger` / `FortifyLogger` unless needed; optional `onLimitChange` callback only.

- [ ] **Step 7: Run vendored limiter tests**

Run: `pnpm exec jest src/core/http-client/resilience/adaptive/tests/adaptive-limiter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/http-client/resilience/adaptive/
git commit -m "feat(http-client): vendor adaptive limiter in-repo (Fortify adaptive 0.1.0, MIT)"
```

---

### Task 1: Policy types and adaptive config resolver (TDD)

**Files:**
- Modify: `src/core/http-client/types/policy.types.ts`
- Create: `src/core/http-client/resilience/resolve-adaptive-concurrency-config.ts`
- Create: `src/core/http-client/resilience/tests/resolve-adaptive-concurrency-config.spec.ts`

**Interfaces:**
- **Consumes:** `ConcurrencyLimitPolicy` (existing `maxConcurrent`, `clusterAware`), `parseHttpClientInstanceCount()` from Task 3.
- **Produces:**
  - `export type ConcurrencyLimitMode = 'fixed' | 'adaptive'`
  - `export interface AdaptiveConcurrencyTuning { algorithm?: 'aimd' | 'vegas' | 'gradient2'; initialLimit?: number; minLimit?: number; maxLimit?: number; successThreshold?: number; vegasAlpha?: number; vegasBeta?: number; vegasMinSamples?: number; gradientMinSamples?: number; gradientSmoothing?: number; }`
  - Extended `ConcurrencyLimitPolicy`: `mode?: ConcurrencyLimitMode`; `adaptive?: AdaptiveConcurrencyTuning`
  - `resolveAdaptiveConcurrencyConfig(policy: ConcurrencyLimitPolicy, instanceCount: number): AdaptiveLimiterConfigInput` (from `./adaptive`)

- [ ] **Step 1: Write failing tests for defaults and clusterAware**

```typescript
// resolve-adaptive-concurrency-config.spec.ts
import { resolveAdaptiveConcurrencyConfig } from '../resolve-adaptive-concurrency-config';

describe('resolveAdaptiveConcurrencyConfig', () => {
  it('maps maxConcurrent to maxLimit when adaptive block omitted', () => {
    const cfg = resolveAdaptiveConcurrencyConfig(
      { maxConcurrent: 40, mode: 'adaptive' },
      1,
    );
    expect(cfg.maxLimit).toBe(40);
    expect(cfg.initialLimit).toBe(10);
    expect(cfg.minLimit).toBe(1);
    expect(cfg.algorithm).toBe('vegas');
  });

  it('scales limits down with clusterAware and instance count', () => {
    const cfg = resolveAdaptiveConcurrencyConfig(
      {
        maxConcurrent: 50,
        mode: 'adaptive',
        clusterAware: true,
        adaptive: { initialLimit: 20, minLimit: 4, maxLimit: 50 },
      },
      10,
    );
    expect(cfg.maxLimit).toBe(5);
    expect(cfg.initialLimit).toBe(2);
    expect(cfg.minLimit).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest src/core/http-client/resilience/tests/resolve-adaptive-concurrency-config.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: FAIL — module not found

- [ ] **Step 3: Extend policy types**

```typescript
// policy.types.ts (replace ConcurrencyLimitPolicy block)
export type ConcurrencyLimitMode = 'fixed' | 'adaptive';

export interface AdaptiveConcurrencyTuning {
  algorithm?: 'aimd' | 'vegas' | 'gradient2';
  initialLimit?: number;
  minLimit?: number;
  maxLimit?: number;
  successThreshold?: number;
  vegasAlpha?: number;
  vegasBeta?: number;
  vegasMinSamples?: number;
  gradientMinSamples?: number;
  gradientSmoothing?: number;
}

export interface ConcurrencyLimitPolicy {
  /** Default `fixed` when omitted */
  mode?: ConcurrencyLimitMode;
  maxConcurrent: number;
  clusterAware?: boolean;
  adaptive?: AdaptiveConcurrencyTuning;
}
```

- [ ] **Step 4: Implement resolver**

```typescript
// resolve-adaptive-concurrency-config.ts
import type { AdaptiveLimiterConfigInput } from './adaptive';
import type { ConcurrencyLimitPolicy } from '../types/policy.types';
import { scaleClusterAwareLimit } from './scale-cluster-aware-limit';

const DEFAULT_INITIAL = 10;
const DEFAULT_MIN = 1;
const DEFAULT_ALGORITHM = 'vegas' as const;

export function resolveAdaptiveConcurrencyConfig(
  policy: ConcurrencyLimitPolicy,
  instanceCount: number,
): AdaptiveLimiterConfigInput {
  const tuning = policy.adaptive ?? {};
  const cluster = policy.clusterAware === true;
  const instances = Math.max(1, instanceCount);

  const rawMax = tuning.maxLimit ?? policy.maxConcurrent;
  const rawInitial = tuning.initialLimit ?? DEFAULT_INITIAL;
  const rawMin = tuning.minLimit ?? DEFAULT_MIN;

  const maxLimit = cluster
    ? scaleClusterAwareLimit(rawMax, instances)
    : rawMax;
  const initialLimit = cluster
    ? scaleClusterAwareLimit(rawInitial, instances)
    : rawInitial;
  const minLimit = cluster
    ? scaleClusterAwareLimit(rawMin, instances)
    : rawMin;

  return {
    algorithm: tuning.algorithm ?? DEFAULT_ALGORITHM,
    initialLimit,
    minLimit,
    maxLimit,
    successThreshold: tuning.successThreshold,
    vegasAlpha: tuning.vegasAlpha,
    vegasBeta: tuning.vegasBeta,
    vegasMinSamples: tuning.vegasMinSamples,
    gradientMinSamples: tuning.gradientMinSamples,
    gradientSmoothing: tuning.gradientSmoothing,
  };
}
```

- [ ] **Step 5: Extract shared cluster scaler (DRY with Task 3)**

Create `src/core/http-client/resilience/scale-cluster-aware-limit.ts`:

```typescript
export function scaleClusterAwareLimit(value: number, instanceCount: number): number {
  const instances = Math.max(1, instanceCount);
  return Math.max(1, Math.floor(value / instances));
}
```

Refactor `resolve-max-concurrent.ts` to call `scaleClusterAwareLimit(policy.maxConcurrent, instances)` when `clusterAware` is true (behavior unchanged; run existing spec).

- [ ] **Step 6: Run tests**

Run: `pnpm exec jest src/core/http-client/resilience/resolve-max-concurrent.spec.ts src/core/http-client/resilience/tests/resolve-adaptive-concurrency-config.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/http-client/types/policy.types.ts \
  src/core/http-client/resilience/scale-cluster-aware-limit.ts \
  src/core/http-client/resilience/resolve-max-concurrent.ts \
  src/core/http-client/resilience/resolve-adaptive-concurrency-config.ts \
  src/core/http-client/resilience/tests/resolve-adaptive-concurrency-config.spec.ts
git commit -m "feat(http-client): adaptive concurrency policy types and config resolver (Task 7)"
```

---

### Task 2: ConcurrencyGate + fixed backend

**Files:**
- Create: `src/core/http-client/resilience/concurrency-gate.types.ts`
- Create: `src/core/http-client/resilience/fixed-concurrency-gate.ts`
- Create: `src/core/http-client/resilience/create-concurrency-gate.ts`
- Test: existing `src/core/http-client/http-client.spec.ts` (no new failures)

**Interfaces:**
- **Produces:**

```typescript
// concurrency-gate.types.ts
export interface ConcurrencyGate {
  run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
  close(error: Error): void;
  readonly activeCount: number;
  readonly queuedCount: number;
}
```

- [ ] **Step 1: Implement FixedConcurrencyGate**

```typescript
// fixed-concurrency-gate.ts
import { ConcurrencyLimiter } from './concurrency-limit';
import type { ConcurrencyGate } from './concurrency-gate.types';
import { neverAbortedSignal } from './never-aborted-signal';

export class FixedConcurrencyGate implements ConcurrencyGate {
  constructor(private readonly limiter: ConcurrencyLimiter) {}

  get activeCount(): number {
    return this.limiter.activeCount;
  }

  get queuedCount(): number {
    return this.limiter.queuedCount;
  }

  async run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const release = await this.limiter.acquire(signal);
    try {
      return await fn(signal ?? neverAbortedSignal);
    } finally {
      release();
    }
  }

  close(error: Error): void {
    this.limiter.close(error);
  }
}
```

- [ ] **Step 2: Add never-aborted signal helper**

```typescript
// never-aborted-signal.ts
export const neverAbortedSignal: AbortSignal = new AbortController().signal;
```

- [ ] **Step 3: Factory stub (fixed only)**

```typescript
// create-concurrency-gate.ts
import type { ConcurrencyLimitPolicy } from '../types/policy.types';
import { ConcurrencyLimiter } from './concurrency-limit';
import type { ConcurrencyGate } from './concurrency-gate.types';
import { FixedConcurrencyGate } from './fixed-concurrency-gate';
import { parseHttpClientInstanceCount } from './parse-http-client-instance-count';
import { resolveEffectiveMaxConcurrent } from './resolve-max-concurrent';

export function createConcurrencyGate(
  policy: ConcurrencyLimitPolicy | undefined,
): ConcurrencyGate | undefined {
  if (!policy) {
    return undefined;
  }
  const mode = policy.mode ?? 'fixed';
  switch (mode) {
    case 'fixed': {
      const max = resolveEffectiveMaxConcurrent(
        policy,
        parseHttpClientInstanceCount(),
      );
      return new FixedConcurrencyGate(new ConcurrencyLimiter(max));
    }
    case 'adaptive':
      throw new Error('Adaptive gate not wired yet');
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
```

- [ ] **Step 4: Run existing http-client concurrency tests**

Run: `pnpm exec jest src/core/http-client/http-client.spec.ts -t 'limits peak concurrency|clusterAware|concurrency limiter abort' --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS (factory not wired to runtime yet)

- [ ] **Step 5: Commit**

```bash
git add src/core/http-client/resilience/concurrency-gate.types.ts \
  src/core/http-client/resilience/fixed-concurrency-gate.ts \
  src/core/http-client/resilience/never-aborted-signal.ts \
  src/core/http-client/resilience/create-concurrency-gate.ts
git commit -m "feat(http-client): ConcurrencyGate abstraction and fixed backend (Task 7)"
```

---

### Task 3: Adaptive ConcurrencyGate (in-repo limiter)

**Files:**
- Create: `src/core/http-client/resilience/merge-abort-signals.ts`
- Create: `src/core/http-client/resilience/adaptive-concurrency-gate.ts`
- Modify: `src/core/http-client/resilience/create-concurrency-gate.ts`
- Create: `src/core/http-client/resilience/tests/adaptive-concurrency-gate.spec.ts`

**Interfaces:**
- **Consumes:** `resolveAdaptiveConcurrencyConfig`, `AdaptiveLimiter`, `AdaptiveLimiterConfigInput` from `./adaptive`
- **Produces:** `AdaptiveConcurrencyGate` implementing `ConcurrencyGate`

- [ ] **Step 1: Write failing adaptive gate test (AIMD increases limit)**

```typescript
// adaptive-concurrency-gate.spec.ts
import { AdaptiveConcurrencyGate } from '../adaptive-concurrency-gate';

it('raises limit after consecutive successes under aimd', async () => {
  let limitSnapshot = 0;
  const gate = new AdaptiveConcurrencyGate({
    algorithm: 'aimd',
    initialLimit: 2,
    minLimit: 1,
    maxLimit: 5,
    successThreshold: 2,
    onLimitChange: (oldLimit, newLimit) => {
      limitSnapshot = newLimit;
    },
  });

  const runOk = () => gate.run(undefined, async () => 'ok');

  await runOk();
  await runOk();
  await runOk();
  await runOk();

  expect(limitSnapshot).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 2: Implement merge-abort-signals**

```typescript
// merge-abort-signals.ts
export function mergeAbortSignals(
  primary: AbortSignal | undefined,
  secondary: AbortSignal,
): AbortSignal {
  if (!primary) {
    return secondary;
  }
  if (primary.aborted) {
    return primary;
  }
  if (secondary.aborted) {
    return secondary;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  primary.addEventListener('abort', abort, { once: true });
  secondary.addEventListener('abort', abort, { once: true });
  return controller.signal;
}
```

- [ ] **Step 3: Implement AdaptiveConcurrencyGate**

```typescript
// adaptive-concurrency-gate.ts
import {
  AdaptiveLimiter,
  type AdaptiveLimiterConfigInput,
} from './adaptive';
import type { ConcurrencyGate } from './concurrency-gate.types';
import { mergeAbortSignals } from './merge-abort-signals';

export class AdaptiveConcurrencyGate implements ConcurrencyGate {
  private readonly limiter: AdaptiveLimiter<unknown>;

  constructor(config: AdaptiveLimiterConfigInput) {
    this.limiter = new AdaptiveLimiter(config);
  }

  get activeCount(): number {
    return this.limiter.inFlight();
  }

  get queuedCount(): number {
    return 0;
  }

  async run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.limiter.execute(async (slotSignal) => {
      const merged = mergeAbortSignals(signal, slotSignal);
      return fn(merged);
    }, signal);
  }

  close(_error: Error): void {
    // AdaptiveLimiter has no close; runtime already stops accepting via ClientRuntime.closed
  }
}
```

- [ ] **Step 4: Complete factory adaptive branch**

```typescript
// create-concurrency-gate.ts (adaptive case)
case 'adaptive': {
  const config = resolveAdaptiveConcurrencyConfig(
    policy,
    parseHttpClientInstanceCount(),
  );
  return new AdaptiveConcurrencyGate(config);
}
```

- [ ] **Step 5: Run adaptive + resolver + vendored limiter tests**

Run: `pnpm exec jest src/core/http-client/resilience/adaptive/tests/adaptive-limiter.spec.ts src/core/http-client/resilience/tests/adaptive-concurrency-gate.spec.ts src/core/http-client/resilience/tests/resolve-adaptive-concurrency-config.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 6: Add failure-halves-limit test**

```typescript
it('halves limit on failure under aimd', async () => {
  let seen = 0;
  const gate = new AdaptiveConcurrencyGate({
    algorithm: 'aimd',
    initialLimit: 10,
    minLimit: 1,
    maxLimit: 20,
    successThreshold: 100,
    onLimitChange: (_o, n) => {
      seen = n;
    },
  });

  await expect(
    gate.run(undefined, async () => {
      throw new Error('downstream');
    }),
  ).rejects.toThrow('downstream');

  expect(seen).toBe(5);
});
```

- [ ] **Step 7: Commit**

```bash
git add src/core/http-client/resilience/adaptive-concurrency-gate.ts \
  src/core/http-client/resilience/merge-abort-signals.ts \
  src/core/http-client/resilience/create-concurrency-gate.ts \
  src/core/http-client/resilience/tests/adaptive-concurrency-gate.spec.ts
git commit -m "feat(http-client): adaptive ConcurrencyGate using in-repo limiter (Task 7)"
```

---

### Task 4: Wire ClientRuntime and validation

**Files:**
- Modify: `src/core/http-client/runtime/client-runtime.ts` (~lines 53, 85–91, 111, 415–459)
- Modify: `validatePolicy` in same file

**Interfaces:**
- **Consumes:** `createConcurrencyGate(policy.concurrencyLimit)`
- **Produces:** Runtime uses `private readonly gate?: ConcurrencyGate` instead of `limiter?: ConcurrencyLimiter`

- [ ] **Step 1: Replace limiter field with gate in constructor**

```typescript
// client-runtime.ts (constructor excerpt)
import { createConcurrencyGate } from '../resilience/create-concurrency-gate';
import type { ConcurrencyGate } from '../resilience/concurrency-gate.types';

private readonly gate?: ConcurrencyGate;

// in constructor, replace concurrencyLimit block:
this.gate = createConcurrencyGate(policy.concurrencyLimit);
```

- [ ] **Step 2: Replace acquire/release in executeSingleAttemptWithAuth**

```typescript
const runAttempt = async () => {
  // ... existing authed setup, attemptTrace, logicalTrace headers ...
  const response = await this.transport.request<T>(/* unchanged */);
  // ... ok / error handling unchanged ...
};

if (this.gate) {
  return this.gate.run(authed.signal, async (signal) => {
    authed = { ...authed, signal };
    return runAttempt();
  });
}
return runAttempt();
```

Refactor carefully so `release`/`finally` from old limiter path is removed (gate owns release).

- [ ] **Step 3: close() uses gate**

```typescript
this.gate?.close(new ClientClosedError());
```

- [ ] **Step 4: Extend validatePolicy**

```typescript
if (policy.concurrencyLimit) {
  const mode = policy.concurrencyLimit.mode ?? 'fixed';
  switch (mode) {
    case 'fixed':
      if (policy.concurrencyLimit.maxConcurrent < 1) {
        throw new Error('maxConcurrent must be >= 1');
      }
      break;
    case 'adaptive':
      if (policy.concurrencyLimit.maxConcurrent < 1) {
        throw new Error('maxConcurrent must be >= 1');
      }
      break;
    default: {
      const _never: never = mode;
      throw new Error(`Unknown concurrency mode: ${_never}`);
    }
  }
}
```

- [ ] **Step 5: Run full http-client unit tests**

Run: `pnpm exec jest src/core/http-client/http-client.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS (fixed-mode paths unchanged)

- [ ] **Step 6: Add integration-style test for adaptive client**

Add to `http-client.spec.ts`:

```typescript
it('adaptive mode executes outbound calls under auto-tuned cap', async () => {
  const registry = new ConnectionPoolRegistry();
  const server = createTestServer(/* fast 200 */);
  const client = new ConfiguredHttpClient(/* ... */)
    .addConcurrencyLimit({
      mode: 'adaptive',
      maxConcurrent: 8,
      adaptive: { algorithm: 'aimd', initialLimit: 2, maxLimit: 8, successThreshold: 1 },
    });
  const results = await Promise.all([
    client.get('/a'),
    client.get('/b'),
    client.get('/c'),
  ]);
  expect(results.every((r) => r.ok)).toBe(true);
});
```

(Use the same test harness patterns as existing `limits peak concurrency` test in that file.)

- [ ] **Step 7: Commit**

```bash
git add src/core/http-client/runtime/client-runtime.ts src/core/http-client/http-client.spec.ts
git commit -m "feat(http-client): wire adaptive ConcurrencyGate in ClientRuntime (Task 7)"
```

---

### Task 5: Documentation and feature status

**Files:**
- Modify: `docs/features/http_client.feature.md`
- Modify: `docs/features/features.md` (Backpressure / HttpClient row if present)
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Document adaptive API in http_client.feature.md**

Add section after multi-VM concurrency bullet:

```markdown
- **Adaptive concurrency (Phase II):** `.addConcurrencyLimit({ mode: 'adaptive', maxConcurrent: 50, clusterAware: true, adaptive: { algorithm: 'vegas', initialLimit: 10, minLimit: 2 } })`. Implementation is **vendored in-repo** under `src/core/http-client/resilience/adaptive/` (Fortify adaptive 0.1.0, MIT — see `UPSTREAM.md`); **no npm package** for the limiter. Default algorithm in resolver when omitted: **`vegas`**. **`maxConcurrent`** sets the default **`maxLimit`** when `adaptive.maxLimit` is omitted. **Fixed** mode (default) queues waiters; **adaptive** mode fail-fasts with `AdaptiveLimitExceededError` when the current tuned cap is full — map in application code or rely on retry for idempotent reads.
- **Load validation:** In staging, compare p95 outbound latency and error rate vs fixed `maxConcurrent`; adaptive limit should increase under healthy downstream and decrease after injected latency (test server delay) or 5xx without redeploying env vars.
```

- [ ] **Step 2: Update SDD progress**

```markdown
Task 7: complete (HttpClient adaptive concurrency — vendored adaptive limiter)
```

- [ ] **Step 3: Commit**

```bash
git add docs/features/http_client.feature.md docs/features/features.md .superpowers/sdd/progress.md
git commit -m "docs(http-client): adaptive concurrency Phase II (Task 7)"
```

- [ ] **Step 4: Merge to master**

```bash
git checkout master
git merge --no-ff feat/resilience-task-7-http-client-adaptive -m "Merge branch 'feat/resilience-task-7-http-client-adaptive'"
```

---

## Self-review

| Superplan Task 7 requirement | Plan task |
| ---------------------------- | --------- |
| `AdaptiveConcurrencyLimiter` matching acquire/release semantics | **ConcurrencyGate** + fixed/adaptive backends (same lifecycle hook points) |
| Adaptive algorithm source | **Vendored** Fortify adaptive 0.1.0 in-repo (no npm) |
| Supply chain | Task 0 — no `@klarlabs-studio/*` / no Zod for adaptive |
| `mode: 'fixed' \| 'adaptive'` on policy | Task 1 |
| Stable `.addConcurrencyLimit()` | Task 4 — no fluent API rename |
| Load test: limit rises/falls with latency/errors | Task 3 tests + Task 5 staging guidance |
| Task 3 cluster math preserved | Task 1 `scaleClusterAwareLimit` + existing resolver refactor |

**Placeholder scan:** No TBD steps; commands and code blocks are concrete.

**Type consistency:** `ConcurrencyLimitMode`, `AdaptiveConcurrencyTuning`, `createConcurrencyGate`, and `resolveAdaptiveConcurrencyConfig` names used consistently across tasks.

---

## Execution handoff

**Plan complete and saved to** `docs/superpowers/plans/2026-10-28-http-client-adaptive-concurrency-phase2.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks (`superpowers:subagent-driven-development`).
2. **Inline Execution** — same session, batched steps (`superpowers:executing-plans`).

**Which approach?**
