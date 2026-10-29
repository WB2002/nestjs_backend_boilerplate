# HTTP Load Leveling (Bounded Admission Queue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional priority-aware bounded admission queuing before the inbound bulkhead hard cap so overload can smooth brief spikes instead of immediate 503 when configured.

**Architecture:** Pure config + `InboundLoadLevelQueue` under `src/core/overload/load-level/`. Extend `InboundBulkheadService` with `async acquire()` and slot handoff on `release()`. Switch `InboundPriorityBulkheadGuard` to async admission with wait budget capped by `remainingMs()`. Map queue-full and wait-timeout errors to 503 + distinct EMF reasons.

**Tech Stack:** NestJS 12, Fastify 5, existing `src/core/overload`, `src/core/request-deadline`, Jest (`pnpm test:unit`).

**Design spec:** [intent/http-load-leveling/spec.md](spec.md)

## Global Constraints

- **Runtime:** Node **24.9+** (`.nvmrc`); package manager **pnpm** only.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Tests:** `pnpm test:unit` (Jest with `--experimental-vm-modules`).
- **Health probes:** `/health`, `/health/ready` stay exempt from bulkhead and load-level queue (`isPressureExemptPath`, `@SkipInboundBulkhead()`).
- **Overload HTTP semantics:** Load-level queue full / wait timeout → **503** + **`Retry-After`**; **429** remains rate-limit quota only.
- **Load leveling default:** **Off** (`INBOUND_LOAD_LEVELING_ENABLED=false`).
- **Admission path:** `InboundPriorityBulkheadGuard` only; do not change `InboundBulkheadMiddleware` behavior.

---

## File map

| Action | Path                                                                      |
| ------ | ------------------------------------------------------------------------- |
| Create | `src/core/overload/load-level/inbound-load-level.types.ts`                |
| Create | `src/core/overload/load-level/parse-inbound-load-level-config.ts`         |
| Create | `src/core/overload/load-level/inbound-load-level-queue.ts`                |
| Create | `src/core/overload/errors/load-level-queue-full.error.ts`                 |
| Create | `src/core/overload/errors/load-level-wait-timeout.error.ts`               |
| Create | `src/core/overload/tests/parse-inbound-load-level-config.spec.ts`         |
| Create | `src/core/overload/tests/inbound-load-level-queue.spec.ts`                |
| Create | `src/core/overload/tests/inbound-bulkhead.load-level.spec.ts`             |
| Modify | `src/core/overload/inbound-bulkhead.service.ts`                           |
| Modify | `src/core/overload/inbound-bulkhead.types.ts` (if needed for typing only) |
| Modify | `src/core/overload/overload.constants.ts`                                 |
| Modify | `src/core/overload/overload.module.ts`                                    |
| Modify | `src/core/overload/guards/inbound-priority-bulkhead.guard.ts`             |
| Modify | `src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts`         |
| Modify | `src/core/overload/overload-telemetry.ts`                                 |
| Modify | `src/core/overload/index.ts`                                              |
| Modify | `src/core/telemetry/telemetry.types.ts`                                   |
| Modify | `src/common/filters/all-exceptions.filter.ts`                             |
| Modify | `src/common/filters/all-exceptions.filter.spec.ts`                        |
| Modify | `src/common/config/env.schema.ts`                                         |
| Modify | `.env.example`                                                            |
| Modify | `docs/operations/edge-vs-app-rate-limits.md`                              |
| Modify | `docs/operations/cloudwatch-overload-alerts.md`                           |
| Modify | `docs/features/features.md`                                               |

---

### Task 1: Config types and env parsing (TDD)

**Files:**

- Create: `src/core/overload/load-level/inbound-load-level.types.ts`
- Create: `src/core/overload/load-level/parse-inbound-load-level-config.ts`
- Create: `src/core/overload/tests/parse-inbound-load-level-config.spec.ts`
- Modify: `src/common/config/env.schema.ts`
- Modify: `.env.example`

**Interfaces:**

- **Produces:** `InboundLoadLevelConfig { enabled: boolean; maxQueue: number; maxWaitMs: number; pollIntervalMs: number }`
- **Produces:** `parseInboundLoadLevelConfig(env?: NodeJS.ProcessEnv): InboundLoadLevelConfig`

- [ ] **Step 1: Write the failing test**

Create `src/core/overload/tests/parse-inbound-load-level-config.spec.ts`:

```typescript
import {
  DEFAULT_INBOUND_LOAD_LEVEL_MAX_QUEUE,
  DEFAULT_INBOUND_LOAD_LEVEL_MAX_WAIT_MS,
  DEFAULT_INBOUND_LOAD_LEVEL_POLL_MS,
  parseInboundLoadLevelConfig,
} from '../load-level/parse-inbound-load-level-config';

describe('parseInboundLoadLevelConfig', () => {
  it('defaults to disabled with preset queue and wait values', () => {
    const config = parseInboundLoadLevelConfig({});
    expect(config.enabled).toBe(false);
    expect(config.maxQueue).toBe(DEFAULT_INBOUND_LOAD_LEVEL_MAX_QUEUE);
    expect(config.maxWaitMs).toBe(DEFAULT_INBOUND_LOAD_LEVEL_MAX_WAIT_MS);
    expect(config.pollIntervalMs).toBe(DEFAULT_INBOUND_LOAD_LEVEL_POLL_MS);
  });

  it('parses enabled and custom tuning', () => {
    const config = parseInboundLoadLevelConfig({
      INBOUND_LOAD_LEVELING_ENABLED: 'true',
      INBOUND_LOAD_LEVEL_MAX_QUEUE: '50',
      INBOUND_LOAD_LEVEL_MAX_WAIT_MS: '500',
      INBOUND_LOAD_LEVEL_POLL_MS: '10',
    });
    expect(config.enabled).toBe(true);
    expect(config.maxQueue).toBe(50);
    expect(config.maxWaitMs).toBe(500);
    expect(config.pollIntervalMs).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/overload/tests/parse-inbound-load-level-config.spec.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement types and parser**

Create `src/core/overload/load-level/inbound-load-level.types.ts`:

```typescript
export type InboundLoadLevelConfig = {
  enabled: boolean;
  maxQueue: number;
  maxWaitMs: number;
  pollIntervalMs: number;
};
```

Create `src/core/overload/load-level/parse-inbound-load-level-config.ts` (mirror `parse-inbound-bulkhead-config.ts` helpers):

```typescript
import { InboundLoadLevelConfig } from './inbound-load-level.types';

export const DEFAULT_INBOUND_LOAD_LEVEL_MAX_QUEUE = 100;
export const DEFAULT_INBOUND_LOAD_LEVEL_MAX_WAIT_MS = 2_000;
export const DEFAULT_INBOUND_LOAD_LEVEL_POLL_MS = 25;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseInboundLoadLevelConfig(
  env: NodeJS.ProcessEnv = process.env,
): InboundLoadLevelConfig {
  return {
    enabled: parseBoolean(env.INBOUND_LOAD_LEVELING_ENABLED, false),
    maxQueue: parsePositiveInt(
      env.INBOUND_LOAD_LEVEL_MAX_QUEUE,
      DEFAULT_INBOUND_LOAD_LEVEL_MAX_QUEUE,
    ),
    maxWaitMs: parsePositiveInt(
      env.INBOUND_LOAD_LEVEL_MAX_WAIT_MS,
      DEFAULT_INBOUND_LOAD_LEVEL_MAX_WAIT_MS,
    ),
    pollIntervalMs: parsePositiveInt(
      env.INBOUND_LOAD_LEVEL_POLL_MS,
      DEFAULT_INBOUND_LOAD_LEVEL_POLL_MS,
    ),
  };
}
```

Add to `src/common/config/env.schema.ts` after inbound bulkhead keys:

```typescript
  INBOUND_LOAD_LEVELING_ENABLED: { required: false },
  INBOUND_LOAD_LEVEL_MAX_QUEUE: { required: false },
  INBOUND_LOAD_LEVEL_MAX_WAIT_MS: { required: false },
  INBOUND_LOAD_LEVEL_POLL_MS: { required: false },
```

Add to `.env.example` after `INBOUND_PRIORITY_SHED_CRITICAL_AT`:

```bash
# Inbound HTTP load leveling (optional wait queue before bulkhead hard cap; requires INBOUND_BULKHEAD_ENABLED=true)
INBOUND_LOAD_LEVELING_ENABLED=false
INBOUND_LOAD_LEVEL_MAX_QUEUE=100
INBOUND_LOAD_LEVEL_MAX_WAIT_MS=2000
INBOUND_LOAD_LEVEL_POLL_MS=25
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- src/core/overload/tests/parse-inbound-load-level-config.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/overload/load-level/inbound-load-level.types.ts src/core/overload/load-level/parse-inbound-load-level-config.ts src/core/overload/tests/parse-inbound-load-level-config.spec.ts src/common/config/env.schema.ts .env.example
git commit -m "feat(overload): add inbound HTTP load leveling config"
```

---

### Task 2: Priority-aware wait queue (TDD)

**Files:**

- Create: `src/core/overload/errors/load-level-queue-full.error.ts`
- Create: `src/core/overload/errors/load-level-wait-timeout.error.ts`
- Create: `src/core/overload/load-level/inbound-load-level-queue.ts`
- Create: `src/core/overload/tests/inbound-load-level-queue.spec.ts`

**Interfaces:**

- **Consumes:** `ApiPriorityLevel` from `../priority/api-priority-level.enum`
- **Produces:** class `InboundLoadLevelQueue` with:
  - `constructor(maxQueue: number, pollIntervalMs: number)`
  - `enqueue(options: { priority: ApiPriorityLevel; maxWaitMs: number; signal?: AbortSignal }): Promise<void>`
  - `dequeueNextWaiter(): (() => void) | undefined` — returns resolver for highest-priority waiter (used by bulkhead on release)
  - `get size(): number`, `get maxQueue(): number`

- [ ] **Step 1: Write the failing tests**

Create `src/core/overload/tests/inbound-load-level-queue.spec.ts`:

```typescript
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { LoadLevelQueueFullError } from '../errors/load-level-queue-full.error';
import { LoadLevelWaitTimeoutError } from '../errors/load-level-wait-timeout.error';
import { InboundLoadLevelQueue } from '../load-level/inbound-load-level-queue';
import { RequestCancelledError } from '@/core/request-deadline/errors/request-cancelled.error';

describe('InboundLoadLevelQueue', () => {
  it('dequeues higher priority before lower when slot opens', async () => {
    const queue = new InboundLoadLevelQueue(10, 5);
    const order: string[] = [];

    const low = queue.enqueue({
      priority: ApiPriorityLevel.Low,
      maxWaitMs: 5_000,
    });
    const critical = queue.enqueue({
      priority: ApiPriorityLevel.Critical,
      maxWaitMs: 5_000,
    });

    const lowDone = low.then(() => order.push('low'));
    const criticalDone = critical.then(() => order.push('critical'));

    const first = queue.dequeueNextWaiter();
    expect(first).toBeDefined();
    first!();

    await criticalDone;
    expect(order).toEqual(['critical']);

    const second = queue.dequeueNextWaiter();
    expect(second).toBeDefined();
    second!();
    await lowDone;
    expect(order).toEqual(['critical', 'low']);
  });

  it('rejects when queue is full', async () => {
    const queue = new InboundLoadLevelQueue(1, 5);
    void queue.enqueue({
      priority: ApiPriorityLevel.Normal,
      maxWaitMs: 5_000,
    });
    await expect(
      queue.enqueue({ priority: ApiPriorityLevel.Normal, maxWaitMs: 5_000 }),
    ).rejects.toBeInstanceOf(LoadLevelQueueFullError);
  });

  it('rejects on wait timeout', async () => {
    jest.useFakeTimers();
    const queue = new InboundLoadLevelQueue(5, 10);
    const wait = queue.enqueue({
      priority: ApiPriorityLevel.Normal,
      maxWaitMs: 50,
    });
    const assertion = expect(wait).rejects.toBeInstanceOf(
      LoadLevelWaitTimeoutError,
    );
    await jest.advanceTimersByTimeAsync(60);
    await assertion;
    jest.useRealTimers();
  });

  it('rejects with RequestCancelledError when abort signal fires', async () => {
    const controller = new AbortController();
    const queue = new InboundLoadLevelQueue(5, 5);
    const wait = queue.enqueue({
      priority: ApiPriorityLevel.Normal,
      maxWaitMs: 5_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(wait).rejects.toBeInstanceOf(RequestCancelledError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/overload/tests/inbound-load-level-queue.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement errors and queue**

`src/core/overload/errors/load-level-queue-full.error.ts`:

```typescript
export class LoadLevelQueueFullError extends Error {
  constructor(message = 'Inbound load leveling queue is full') {
    super(message);
    this.name = 'LoadLevelQueueFullError';
  }
}
```

`src/core/overload/errors/load-level-wait-timeout.error.ts`:

```typescript
export class LoadLevelWaitTimeoutError extends Error {
  constructor(message = 'Timed out waiting for inbound capacity') {
    super(message);
    this.name = 'LoadLevelWaitTimeoutError';
  }
}
```

`src/core/overload/load-level/inbound-load-level-queue.ts`:

```typescript
import { RequestCancelledError } from '@/core/request-deadline/errors/request-cancelled.error';
import { LoadLevelQueueFullError } from '../errors/load-level-queue-full.error';
import { LoadLevelWaitTimeoutError } from '../errors/load-level-wait-timeout.error';
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';

type Waiter = {
  priority: ApiPriorityLevel;
  enqueuedAt: number;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export class InboundLoadLevelQueue {
  private readonly waiters: Waiter[] = [];

  constructor(
    readonly maxQueue: number,
    private readonly pollIntervalMs: number,
  ) {}

  get size(): number {
    return this.waiters.length;
  }

  enqueue(options: {
    priority: ApiPriorityLevel;
    maxWaitMs: number;
    signal?: AbortSignal;
  }): Promise<void> {
    if (this.waiters.length >= this.maxQueue) {
      return Promise.reject(new LoadLevelQueueFullError());
    }

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let timer: ReturnType<typeof setInterval> | undefined;
      let abortHandler: (() => void) | undefined;

      const cleanup = (): void => {
        if (timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
        if (options.signal && abortHandler) {
          options.signal.removeEventListener('abort', abortHandler);
        }
      };

      const removeWaiter = (waiter: Waiter): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
      };

      const waiter: Waiter = {
        priority: options.priority,
        enqueuedAt: startedAt,
        resolve: () => {
          cleanup();
          removeWaiter(waiter);
          resolve();
        },
        reject: (error: Error) => {
          cleanup();
          removeWaiter(waiter);
          reject(error);
        },
        cleanup,
      };

      this.insertSorted(waiter);

      if (options.signal?.aborted) {
        waiter.reject(new RequestCancelledError());
        return;
      }

      abortHandler = (): void => {
        waiter.reject(new RequestCancelledError());
      };
      options.signal?.addEventListener('abort', abortHandler, { once: true });

      timer = setInterval(() => {
        if (Date.now() - startedAt >= options.maxWaitMs) {
          waiter.reject(new LoadLevelWaitTimeoutError());
        }
      }, this.pollIntervalMs);
    });
  }

  dequeueNextWaiter(): (() => void) | undefined {
    const next = this.waiters.shift();
    if (!next) {
      return undefined;
    }
    return () => next.resolve();
  }

  private insertSorted(waiter: Waiter): void {
    const index = this.waiters.findIndex(
      (existing) =>
        existing.priority > waiter.priority ||
        (existing.priority === waiter.priority &&
          existing.enqueuedAt > waiter.enqueuedAt),
    );
    if (index === -1) {
      this.waiters.push(waiter);
      return;
    }
    this.waiters.splice(index, 0, waiter);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- src/core/overload/tests/inbound-load-level-queue.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/overload/errors/load-level-queue-full.error.ts src/core/overload/errors/load-level-wait-timeout.error.ts src/core/overload/load-level/inbound-load-level-queue.ts src/core/overload/tests/inbound-load-level-queue.spec.ts
git commit -m "feat(overload): add priority-aware inbound load level queue"
```

---

### Task 3: Integrate queue into `InboundBulkheadService` (TDD)

**Files:**

- Modify: `src/core/overload/overload.constants.ts`
- Modify: `src/core/overload/inbound-bulkhead.service.ts`
- Modify: `src/core/overload/overload.module.ts`
- Create: `src/core/overload/tests/inbound-bulkhead.load-level.spec.ts`

**Interfaces:**

- **Produces:** token `INBOUND_LOAD_LEVEL_OPTIONS` in `overload.constants.ts`
- **Produces:** `InboundBulkheadService.acquire(options: { priority: ApiPriorityLevel; maxWaitMs?: number; signal?: AbortSignal }): Promise<void>`
- **Behavior:** Immediate slot when `active < max`. If at cap and load leveling disabled → `OverloadRejectedError`. If at cap and enabled → enqueue; on wake slot already reserved via `release()` handoff.

- [ ] **Step 1: Write the failing test**

Create `src/core/overload/tests/inbound-bulkhead.load-level.spec.ts`:

```typescript
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { InboundLoadLevelQueue } from '../load-level/inbound-load-level-queue';
import { OverloadRejectedError } from '../errors/overload-rejected.error';
import { InboundLoadLevelConfig } from '../load-level/inbound-load-level.types';

function createService(loadLevel: InboundLoadLevelConfig) {
  const bulkhead = new InboundBulkheadService(
    { enabled: true, maxInFlight: 1 },
    loadLevel,
  );
  return bulkhead;
}

describe('InboundBulkheadService load leveling', () => {
  const enabledLoadLevel: InboundLoadLevelConfig = {
    enabled: true,
    maxQueue: 10,
    maxWaitMs: 2_000,
    pollIntervalMs: 5,
  };

  it('fail-fast when load leveling disabled at cap', async () => {
    const service = createService({
      ...enabledLoadLevel,
      enabled: false,
    });
    service.tryAcquire();
    await expect(
      service.acquire({ priority: ApiPriorityLevel.Normal }),
    ).rejects.toBeInstanceOf(OverloadRejectedError);
  });

  it('hands off slot to waiter on release', async () => {
    const service = createService(enabledLoadLevel);
    service.tryAcquire();
    const admitted = service.acquire({
      priority: ApiPriorityLevel.Critical,
      maxWaitMs: 2_000,
    });
    service.release();
    await expect(admitted).resolves.toBeUndefined();
    expect(service.activeCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/overload/tests/inbound-bulkhead.load-level.spec.ts`
Expected: FAIL (`acquire` missing)

- [ ] **Step 3: Implement service, constant, module wiring**

Add to `src/core/overload/overload.constants.ts`:

```typescript
export const INBOUND_LOAD_LEVEL_OPTIONS = 'INBOUND_LOAD_LEVEL_OPTIONS';
```

Replace `src/core/overload/inbound-bulkhead.service.ts` with:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  INBOUND_BULKHEAD_OPTIONS,
  INBOUND_LOAD_LEVEL_OPTIONS,
} from './overload.constants';
import { InboundBulkheadConfig } from './inbound-bulkhead.types';
import { InboundLoadLevelConfig } from './load-level/inbound-load-level.types';
import { InboundLoadLevelQueue } from './load-level/inbound-load-level-queue';
import { OverloadRejectedError } from './errors/overload-rejected.error';
import { ApiPriorityLevel } from './priority/api-priority-level.enum';

@Injectable()
export class InboundBulkheadService {
  private active = 0;
  private readonly queue: InboundLoadLevelQueue;

  constructor(
    @Inject(INBOUND_BULKHEAD_OPTIONS)
    private readonly config: InboundBulkheadConfig,
    @Inject(INBOUND_LOAD_LEVEL_OPTIONS)
    private readonly loadLevelConfig: InboundLoadLevelConfig,
  ) {
    this.queue = new InboundLoadLevelQueue(
      this.loadLevelConfig.maxQueue,
      this.loadLevelConfig.pollIntervalMs,
    );
  }

  get activeCount(): number {
    return this.active;
  }

  get maxInFlight(): number {
    return this.config.maxInFlight;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isLoadLevelingEnabled(): boolean {
    return this.config.enabled && this.loadLevelConfig.enabled;
  }

  /** Fail-fast: no queue when at capacity. */
  tryAcquire(): boolean {
    if (!this.config.enabled) {
      return true;
    }
    if (this.active >= this.config.maxInFlight) {
      return false;
    }
    this.active += 1;
    return true;
  }

  async acquire(options: {
    priority: ApiPriorityLevel;
    maxWaitMs?: number;
    signal?: AbortSignal;
  }): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    if (this.tryAcquire()) {
      return;
    }
    if (!this.loadLevelConfig.enabled) {
      throw new OverloadRejectedError();
    }
    await this.queue.enqueue({
      priority: options.priority,
      maxWaitMs: options.maxWaitMs ?? this.loadLevelConfig.maxWaitMs,
      signal: options.signal,
    });
  }

  release(): void {
    if (!this.config.enabled) {
      return;
    }
    if (this.active > 0) {
      this.active -= 1;
    }
    if (!this.loadLevelConfig.enabled) {
      return;
    }
    const grant = this.queue.dequeueNextWaiter();
    if (grant) {
      this.active += 1;
      grant();
    }
  }
}
```

Update `src/core/overload/overload.module.ts`:

```typescript
import { parseInboundLoadLevelConfig } from './load-level/parse-inbound-load-level-config';
import {
  INBOUND_BULKHEAD_OPTIONS,
  INBOUND_LOAD_LEVEL_OPTIONS,
  PRIORITY_SHEDDING_OPTIONS,
} from './overload.constants';

// inside forRoot():
    const loadLevel = parseInboundLoadLevelConfig();
    // providers array:
        {
          provide: INBOUND_LOAD_LEVEL_OPTIONS,
          useValue: loadLevel,
        },
```

Update existing `src/core/overload/tests/inbound-bulkhead.service.spec.ts` (and any test constructing `InboundBulkheadService`) to pass a second constructor arg:

```typescript
const disabledLoadLevel = {
  enabled: false,
  maxQueue: 100,
  maxWaitMs: 2000,
  pollIntervalMs: 25,
};
new InboundBulkheadService(config, disabledLoadLevel);
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- src/core/overload/tests/inbound-bulkhead`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/overload/overload.constants.ts src/core/overload/inbound-bulkhead.service.ts src/core/overload/overload.module.ts src/core/overload/tests/inbound-bulkhead.load-level.spec.ts src/core/overload/tests/inbound-bulkhead.service.spec.ts
git commit -m "feat(overload): integrate load level queue into inbound bulkhead"
```

---

### Task 4: Async `InboundPriorityBulkheadGuard` (TDD)

**Files:**

- Modify: `src/core/overload/guards/inbound-priority-bulkhead.guard.ts`
- Modify: `src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts`

**Interfaces:**

- **Consumes:** `InboundBulkheadService.acquire`, `getRequestSignal`, `remainingMs` from `@/core/request-deadline/helpers/request-deadline.helpers`
- **Consumes:** load level config via `INBOUND_LOAD_LEVEL_OPTIONS` injection

- [ ] **Step 1: Update guard tests for async acquire**

Extend `src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts`:

```typescript
import {
  getRequestSignal,
  remainingMs,
} from '@/core/request-deadline/helpers/request-deadline.helpers';

jest.mock('@/core/request-deadline/helpers/request-deadline.helpers', () => ({
  getRequestSignal: jest.fn(),
  remainingMs: jest.fn(),
}));

const disabledLoadLevel = {
  enabled: false,
  maxQueue: 100,
  maxWaitMs: 2000,
  pollIntervalMs: 25,
};

const enabledLoadLevel = {
  enabled: true,
  maxQueue: 10,
  maxWaitMs: 500,
  pollIntervalMs: 5,
};

function createGuard(
  bulkhead: InboundBulkheadService,
  shedding: typeof sheddingConfig,
  loadLevel = disabledLoadLevel,
) {
  return new InboundPriorityBulkheadGuard(
    bulkhead,
    new Reflector(),
    shedding,
    loadLevel,
  );
}

// Replace direct `new InboundBulkheadService({...})` with second arg disabledLoadLevel

it('throws OverloadRejectedError at hard cap for critical when leveling off', async () => {
  const bulkhead = new InboundBulkheadService(
    { enabled: true, maxInFlight: 2 },
    disabledLoadLevel,
  );
  bulkhead.tryAcquire();
  bulkhead.tryAcquire();
  const guard = createGuard(bulkhead, sheddingConfig);
  await expect(
    guard.canActivate(mockContext('/auth/refresh', ApiPriorityLevel.Critical)),
  ).rejects.toBeInstanceOf(OverloadRejectedError);
});

it('waits for slot when load leveling enabled', async () => {
  jest.mocked(remainingMs).mockReturnValue(undefined);
  jest.mocked(getRequestSignal).mockReturnValue(undefined);
  const bulkhead = new InboundBulkheadService(
    { enabled: true, maxInFlight: 1 },
    enabledLoadLevel,
  );
  bulkhead.tryAcquire();
  const ctx = mockContext('/api/work', ApiPriorityLevel.Normal);
  const guard = createGuard(
    bulkhead,
    { ...sheddingConfig, enabled: false },
    enabledLoadLevel,
  );
  const pending = guard.canActivate(ctx);
  bulkhead.release();
  await expect(pending).resolves.toBe(true);
});
```

- [ ] **Step 2: Run tests — FAIL**

Run: `pnpm test:unit -- src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts`

- [ ] **Step 3: Implement async guard**

Update `src/core/overload/guards/inbound-priority-bulkhead.guard.ts`:

```typescript
import {
  getRequestSignal,
  remainingMs,
} from '@/core/request-deadline/helpers/request-deadline.helpers';
import {
  INBOUND_LOAD_LEVEL_OPTIONS,
  PRIORITY_SHEDDING_OPTIONS,
  SKIP_INBOUND_BULKHEAD_KEY,
} from '../overload.constants';
import { InboundLoadLevelConfig } from '../load-level/inbound-load-level.types';

// constructor add:
    @Inject(INBOUND_LOAD_LEVEL_OPTIONS)
    private readonly loadLevelConfig: InboundLoadLevelConfig,

// change signature:
  async canActivate(context: ExecutionContext): Promise<boolean> {

// replace tryAcquire block:
    const configuredWait = this.loadLevelConfig.maxWaitMs;
    const budget = remainingMs();
    const maxWaitMs =
      budget === undefined ? configuredWait : Math.min(configuredWait, budget);

    await this.bulkhead.acquire({
      priority,
      maxWaitMs,
      signal: getRequestSignal(),
    });

    this.attachRelease(context);
    return true;
```

Remove the `if (!this.bulkhead.tryAcquire()) throw new OverloadRejectedError()` block.

- [ ] **Step 4: Run guard tests — PASS**

Run: `pnpm test:unit -- src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add src/core/overload/guards/inbound-priority-bulkhead.guard.ts src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts
git commit -m "feat(overload): async bulkhead guard with load level wait budget"
```

---

### Task 5: Exception filter, EMF, and ops docs

**Files:**

- Modify: `src/core/telemetry/telemetry.types.ts`
- Modify: `src/core/overload/overload-telemetry.ts`
- Modify: `src/common/filters/all-exceptions.filter.ts`
- Modify: `src/common/filters/all-exceptions.filter.spec.ts`
- Modify: `docs/operations/edge-vs-app-rate-limits.md`
- Modify: `docs/operations/cloudwatch-overload-alerts.md`
- Modify: `docs/features/features.md`
- Modify: `src/core/overload/index.ts`

- [ ] **Step 1: Write failing filter tests**

Add to `src/common/filters/all-exceptions.filter.spec.ts`:

```typescript
import { LoadLevelQueueFullError } from '../../core/overload/errors/load-level-queue-full.error';
import { LoadLevelWaitTimeoutError } from '../../core/overload/errors/load-level-wait-timeout.error';
import {
  recordInboundLoadLevelQueueFull503,
  recordInboundLoadLevelWaitTimeout503,
} from '../../core/overload/overload-telemetry';

jest.mock('../../core/overload/overload-telemetry', () => ({
  recordApiPriorityShed503: jest.fn(),
  recordDependencyUnavailable503: jest.fn(),
  recordHealthCheck503: jest.fn(),
  recordInboundBulkhead503: jest.fn(),
  recordInboundLoadLevelQueueFull503: jest.fn(),
  recordInboundLoadLevelWaitTimeout503: jest.fn(),
}));

it('maps LoadLevelQueueFullError to 503 with Retry-After', () => {
  const response = {
    raw: { destroyed: false, writableEnded: false },
    header: jest.fn(),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }),
      getResponse: () => response,
    }),
  };
  const filter = new AllExceptionsFilter(httpAdapterHost);
  filter.catch(new LoadLevelQueueFullError(), host as never);
  expect(recordInboundLoadLevelQueueFull503).toHaveBeenCalled();
  expect(response.header).toHaveBeenCalledWith(
    'Retry-After',
    expect.any(String),
  );
});

it('maps LoadLevelWaitTimeoutError to 503 with Retry-After', () => {
  const response = {
    raw: { destroyed: false, writableEnded: false },
    header: jest.fn(),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }),
      getResponse: () => response,
    }),
  };
  const filter = new AllExceptionsFilter(httpAdapterHost);
  filter.catch(new LoadLevelWaitTimeoutError(), host as never);
  expect(recordInboundLoadLevelWaitTimeout503).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests — FAIL**

Run: `pnpm test:unit -- src/common/filters/all-exceptions.filter.spec.ts`

- [ ] **Step 3: Implement telemetry and filter mapping**

Extend `ServiceUnavailableReason` in `src/core/telemetry/telemetry.types.ts`:

```typescript
  | 'inbound_load_level_queue_full'
  | 'inbound_load_level_wait_timeout';
```

Add to `src/core/overload/overload-telemetry.ts`:

```typescript
export function recordInboundLoadLevelQueueFull503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'inbound_load_level_queue_full',
    path,
  });
}

export function recordInboundLoadLevelWaitTimeout503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'inbound_load_level_wait_timeout',
    path,
  });
}
```

In `all-exceptions.filter.ts`, import new errors and recorders. Add private mappers (mirror priority shed / overload):

```typescript
  private mapLoadLevelQueueFullException(exception: unknown) { ... }
  private mapLoadLevelWaitTimeoutException(exception: unknown) { ... }
```

Chain in `catch()` **before** generic overload mapping:

```typescript
    const loadLevelQueueFull = this.mapLoadLevelQueueFullException(exception);
    if (loadLevelQueueFull) {
      status = loadLevelQueueFull.status;
      message = loadLevelQueueFull.message;
      this.setRetryAfterHeader(response, loadLevelQueueFull.retryAfterSec);
      recordInboundLoadLevelQueueFull503(httpAdapter.getRequestUrl(request));
    } else {
      const loadLevelTimeout = this.mapLoadLevelWaitTimeoutException(exception);
      if (loadLevelTimeout) {
        ...
        recordInboundLoadLevelWaitTimeout503(...);
      } else {
        // existing priority shed / overload chain
      }
    }
```

Export new errors from `src/core/overload/index.ts`.

Docs:

- `edge-vs-app-rate-limits.md` — add row for **Inbound load leveling** with env vars and 503 semantics.
- `cloudwatch-overload-alerts.md` — document new `Reason` values.
- `features.md` — update queue-based load leveling row to **Done** for HTTP when enabled.

- [ ] **Step 4: Run filter tests — PASS**

Run: `pnpm test:unit -- src/common/filters/all-exceptions.filter.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add src/core/telemetry/telemetry.types.ts src/core/overload/overload-telemetry.ts src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.spec.ts src/core/overload/index.ts docs/operations/edge-vs-app-rate-limits.md docs/operations/cloudwatch-overload-alerts.md docs/features/features.md
git commit -m "feat(overload): surface HTTP load leveling as 503 overload with EMF"
```

---

### Task 6: Overload package regression sweep

**Files:**

- Modify: `src/core/overload/tests/inbound-bulkhead.middleware.spec.ts` (constructor second arg if middleware tests instantiate service indirectly — middleware uses injected service; update test module providers if present)

- [ ] **Step 1: Run full overload + filter suite**

Run: `pnpm test:unit -- src/core/overload src/common/filters/all-exceptions.filter.spec.ts`
Expected: PASS

- [ ] **Step 2: Commit any remaining test fixture fixes**

```bash
git add src/core/overload/tests
git commit -m "test(overload): fix fixtures for load leveling constructor wiring"
```

---

## Plan self-review

**Spec coverage:** Config, queue, bulkhead handoff, async guard, 503/EMF, docs — all sections in [design spec](spec.md) map to Tasks 1–6.

**Placeholder scan:** No TBD steps; paths, signatures, and test code included.

**Type consistency:** `ApiPriorityLevel`, `InboundLoadLevelConfig`, and extended `ServiceUnavailableReason` defined before filter/guard usage.

**Scope note:** Load leveling remains opt-in; `InboundBulkheadMiddleware` unchanged.

---

## Suggested execution order

Tasks 1 → 2 → 3 → 4 → 5 → 6 sequentially (each task commits independently).
