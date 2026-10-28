# API Priority Shedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When inbound load approaches the per-VM in-flight cap, **fail-fast shed lower-priority API traffic first** (low → normal → high) while keeping **critical** routes (auth, session refresh) admitted longer—completing the overload story alongside under-pressure, bulkhead caps, and GraphQL concurrency.

**Architecture:** Keep **`InboundBulkheadService`** as the single in-flight counter. Replace **`InboundBulkheadMiddleware`** registration with **`InboundPriorityBulkheadGuard`** so `@ApiPriority()` metadata is available via `Reflector`. Pure helpers compute **utilization-based shed decisions** before `tryAcquire()`. Shedding and hard-cap rejects both map to **503** + **`Retry-After`**; EMF uses distinct **`Reason`** values (`api_priority_shed` vs `inbound_bulkhead`). Health probes stay exempt via existing `@SkipInboundBulkhead()` + `PRESSURE_EXEMPT_PATHS`.

**Tech Stack:** NestJS 11, Fastify 5, existing `src/core/overload`, Jest (`pnpm exec jest … --watchman=false --testPathIgnorePatterns='.worktrees'`).

## Global Constraints

- **Runtime:** Node **22+**; package manager **pnpm**; tests via **`pnpm exec jest … --watchman=false --testPathIgnorePatterns='.worktrees'`**.
- **HTTP server:** Fastify via `@nestjs/platform-fastify`; global guards in **`src/app.module.ts`**.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Health probes:** `/health`, `/health/ready` exempt from bulkhead/priority shedding (same as today).
- **Overload HTTP semantics:** Shedding and bulkhead hard-cap → **503 Service Unavailable** + **`Retry-After`** (seconds from `OVERLOAD_RETRY_AFTER_SEC`); **429** remains **`RateLimitGuard`** quota abuse only.
- **Multi-VM:** Priority shedding and in-flight cap remain **per process**; cluster approximate cap ≈ **`N × INBOUND_MAX_IN_FLIGHT`** (document in ops guide).
- **Scope OUT:** Request **queues** or waiting (still fail-fast); Redis cluster-wide semaphore; coupling to BullMQ job priority; changing GraphQL Redis concurrency algorithm (separate layer).

---

## File map

| File | Responsibility |
| ---- | -------------- |
| `src/core/overload/priority/api-priority-level.enum.ts` | Ordered priority tiers |
| `src/core/overload/priority/priority-shedding.types.ts` | Config + threshold types |
| `src/core/overload/priority/default-priority-shedding-thresholds.ts` | Default utilization cutoffs |
| `src/core/overload/priority/should-shed-priority-request.ts` | Pure shed decision |
| `src/core/overload/priority/parse-priority-shedding-config.ts` | Env → config |
| `src/core/overload/priority/resolve-api-priority.ts` | Reflector + default |
| `src/core/overload/decorators/api-priority.decorator.ts` | `@ApiPriority()` |
| `src/core/overload/guards/inbound-priority-bulkhead.guard.ts` | Acquire/release + shed |
| `src/core/overload/errors/priority-shed-rejected.error.ts` | Distinct 503 error type |
| `src/core/overload/inbound-bulkhead.service.ts` | Add `utilization()` helper |
| `src/core/overload/overload-telemetry.ts` | `recordApiPriorityShed503` |
| `src/core/telemetry/telemetry.types.ts` | Extend `ServiceUnavailableReason` |
| `src/common/filters/all-exceptions.filter.ts` | Map shed error + EMF reason |
| `src/app.module.ts` | Register guard; remove middleware from chain |
| `src/auth/auth.controller.ts` | `@ApiPriority(Critical)` on auth routes |
| `src/common/config/env.schema.ts` | New env keys |
| `.env.example` | Document priority shedding |
| `docs/operations/edge-vs-app-rate-limits.md` | Decision table row |
| `docs/operations/cloudwatch-overload-alerts.md` | New alarm recipe |
| `docs/features/features.md` | Status rows → Done / Partial |

---

### Task 1: Priority tiers and pure shedding math (TDD)

**Files:**
- Create: `src/core/overload/priority/api-priority-level.enum.ts`
- Create: `src/core/overload/priority/priority-shedding.types.ts`
- Create: `src/core/overload/priority/default-priority-shedding-thresholds.ts`
- Create: `src/core/overload/priority/should-shed-priority-request.ts`
- Create: `src/core/overload/tests/should-shed-priority-request.spec.ts`

**Interfaces:**
- **Produces:**
  - `ApiPriorityLevel` enum: `Critical = 0`, `High = 1`, `Normal = 2`, `Low = 3` (lower number = higher priority).
  - `PrioritySheddingThresholds`: `{ critical: number; high: number; normal: number; low: number }` — each in **(0, 1]**, max utilization **before** that tier is shed.
  - `shouldShedPriorityRequest(options: { active: number; maxInFlight: number; priority: ApiPriorityLevel; thresholds: PrioritySheddingThresholds }): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/core/overload/tests/should-shed-priority-request.spec.ts`:

```typescript
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { DEFAULT_PRIORITY_SHEDDING_THRESHOLDS } from '../priority/default-priority-shedding-thresholds';
import { shouldShedPriorityRequest } from '../priority/should-shed-priority-request';

describe('shouldShedPriorityRequest', () => {
  const thresholds = DEFAULT_PRIORITY_SHEDDING_THRESHOLDS;

  it('does not shed when utilization is below low threshold', () => {
    expect(
      shouldShedPriorityRequest({
        active: 50,
        maxInFlight: 100,
        priority: ApiPriorityLevel.Low,
        thresholds,
      }),
    ).toBe(false);
  });

  it('sheds low priority at 70% utilization before hard cap', () => {
    expect(
      shouldShedPriorityRequest({
        active: 70,
        maxInFlight: 100,
        priority: ApiPriorityLevel.Low,
        thresholds,
      }),
    ).toBe(true);
  });

  it('still admits critical at 99% utilization', () => {
    expect(
      shouldShedPriorityRequest({
        active: 99,
        maxInFlight: 100,
        priority: ApiPriorityLevel.Critical,
        thresholds,
      }),
    ).toBe(false);
  });

  it('sheds high but not critical at 96% utilization', () => {
    expect(
      shouldShedPriorityRequest({
        active: 96,
        maxInFlight: 100,
        priority: ApiPriorityLevel.High,
        thresholds,
      }),
    ).toBe(true);
    expect(
      shouldShedPriorityRequest({
        active: 96,
        maxInFlight: 100,
        priority: ApiPriorityLevel.Critical,
        thresholds,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest src/core/overload/tests/should-shed-priority-request.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement enum, defaults, and pure function**

Create `src/core/overload/priority/api-priority-level.enum.ts`:

```typescript
export enum ApiPriorityLevel {
  Critical = 0,
  High = 1,
  Normal = 2,
  Low = 3,
}
```

Create `src/core/overload/priority/default-priority-shedding-thresholds.ts`:

```typescript
import { PrioritySheddingThresholds } from './priority-shedding.types';

/** Utilization ratio (active/max) at or above which a tier is shed. */
export const DEFAULT_PRIORITY_SHEDDING_THRESHOLDS: PrioritySheddingThresholds = {
  critical: 1,
  high: 0.95,
  normal: 0.85,
  low: 0.7,
};
```

Create `src/core/overload/priority/priority-shedding.types.ts`:

```typescript
import { ApiPriorityLevel } from './api-priority-level.enum';

export type PrioritySheddingThresholds = {
  critical: number;
  high: number;
  normal: number;
  low: number;
};

export type PrioritySheddingConfig = {
  enabled: boolean;
  defaultPriority: ApiPriorityLevel;
  thresholds: PrioritySheddingThresholds;
};
```

Create `src/core/overload/priority/should-shed-priority-request.ts`:

```typescript
import { ApiPriorityLevel } from './api-priority-level.enum';
import { PrioritySheddingThresholds } from './priority-shedding.types';

const THRESHOLD_BY_PRIORITY: Record<ApiPriorityLevel, keyof PrioritySheddingThresholds> = {
  [ApiPriorityLevel.Critical]: 'critical',
  [ApiPriorityLevel.High]: 'high',
  [ApiPriorityLevel.Normal]: 'normal',
  [ApiPriorityLevel.Low]: 'low',
};

export function computeInboundUtilization(active: number, maxInFlight: number): number {
  if (maxInFlight <= 0) {
    return 1;
  }
  return active / maxInFlight;
}

export function shouldShedPriorityRequest(options: {
  active: number;
  maxInFlight: number;
  priority: ApiPriorityLevel;
  thresholds: PrioritySheddingThresholds;
}): boolean {
  const utilization = computeInboundUtilization(options.active, options.maxInFlight);
  const key = THRESHOLD_BY_PRIORITY[options.priority];
  const maxAllowed = options.thresholds[key];
  return utilization >= maxAllowed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest src/core/overload/tests/should-shed-priority-request.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/overload/priority src/core/overload/tests/should-shed-priority-request.spec.ts
git commit -m "feat(overload): add pure API priority shedding thresholds"
```

---

### Task 2: Env parsing and `@ApiPriority()` decorator

**Files:**
- Create: `src/core/overload/priority/parse-priority-shedding-config.ts`
- Create: `src/core/overload/priority/resolve-api-priority.ts`
- Create: `src/core/overload/decorators/api-priority.decorator.ts`
- Modify: `src/core/overload/overload.constants.ts`
- Modify: `src/common/config/env.schema.ts`
- Create: `src/core/overload/tests/parse-priority-shedding-config.spec.ts`

**Interfaces:**
- **Consumes:** `DEFAULT_PRIORITY_SHEDDING_THRESHOLDS`, `ApiPriorityLevel`.
- **Produces:**
  - `API_PRIORITY_KEY`, `DEFAULT_API_PRIORITY_LEVEL = ApiPriorityLevel.Normal`
  - `parsePrioritySheddingConfig(env): PrioritySheddingConfig`
  - `ApiPriority(level: ApiPriorityLevel)` decorator
  - `resolveApiPriority(reflector, context): ApiPriorityLevel`

- [ ] **Step 1: Write failing config parse test**

Create `src/core/overload/tests/parse-priority-shedding-config.spec.ts`:

```typescript
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { parsePrioritySheddingConfig } from '../priority/parse-priority-shedding-config';

describe('parsePrioritySheddingConfig', () => {
  it('disables shedding by default', () => {
    expect(parsePrioritySheddingConfig({})).toEqual(
      expect.objectContaining({
        enabled: false,
        defaultPriority: ApiPriorityLevel.Normal,
      }),
    );
  });

  it('enables when INBOUND_PRIORITY_SHEDDING_ENABLED=true', () => {
    expect(
      parsePrioritySheddingConfig({ INBOUND_PRIORITY_SHEDDING_ENABLED: 'true' }),
    ).toEqual(expect.objectContaining({ enabled: true }));
  });

  it('parses custom low threshold', () => {
    expect(
      parsePrioritySheddingConfig({
        INBOUND_PRIORITY_SHED_LOW_AT: '0.6',
      }).thresholds.low,
    ).toBe(0.6);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm exec jest src/core/overload/tests/parse-priority-shedding-config.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

- [ ] **Step 3: Implement parser, constants, decorator, resolver**

Add to `src/core/overload/overload.constants.ts`:

```typescript
export const API_PRIORITY_KEY = 'apiPriority';
export const PRIORITY_SHEDDING_OPTIONS = 'PRIORITY_SHEDDING_OPTIONS';
```

Create `src/core/overload/priority/parse-priority-shedding-config.ts` (mirror `parse-inbound-bulkhead-config.ts` boolean/ float helpers):

```typescript
import { ApiPriorityLevel } from './api-priority-level.enum';
import { DEFAULT_PRIORITY_SHEDDING_THRESHOLDS } from './default-priority-shedding-thresholds';
import { PrioritySheddingConfig } from './priority-shedding.types';

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

function parseRatio(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function parseDefaultPriority(value: string | undefined): ApiPriorityLevel {
  const normalized = (value ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'critical':
      return ApiPriorityLevel.Critical;
    case 'high':
      return ApiPriorityLevel.High;
    case 'low':
      return ApiPriorityLevel.Low;
    case 'normal':
    case '':
      return ApiPriorityLevel.Normal;
    default:
      return ApiPriorityLevel.Normal;
  }
}

export function parsePrioritySheddingConfig(
  env: NodeJS.ProcessEnv = process.env,
): PrioritySheddingConfig {
  const enabled = parseBoolean(env.INBOUND_PRIORITY_SHEDDING_ENABLED, false);
  const defaultPriority = parseDefaultPriority(env.INBOUND_DEFAULT_API_PRIORITY);
  const thresholds = {
    critical: parseRatio(
      env.INBOUND_PRIORITY_SHED_CRITICAL_AT,
      DEFAULT_PRIORITY_SHEDDING_THRESHOLDS.critical,
    ),
    high: parseRatio(
      env.INBOUND_PRIORITY_SHED_HIGH_AT,
      DEFAULT_PRIORITY_SHEDDING_THRESHOLDS.high,
    ),
    normal: parseRatio(
      env.INBOUND_PRIORITY_SHED_NORMAL_AT,
      DEFAULT_PRIORITY_SHEDDING_THRESHOLDS.normal,
    ),
    low: parseRatio(
      env.INBOUND_PRIORITY_SHED_LOW_AT,
      DEFAULT_PRIORITY_SHEDDING_THRESHOLDS.low,
    ),
  };
  return { enabled, defaultPriority, thresholds };
}
```

Create `src/core/overload/decorators/api-priority.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { API_PRIORITY_KEY } from '../overload.constants';

export const ApiPriority = (level: ApiPriorityLevel) =>
  SetMetadata(API_PRIORITY_KEY, level);
```

Create `src/core/overload/priority/resolve-api-priority.ts`:

```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_PRIORITY_KEY } from '../overload.constants';
import { ApiPriorityLevel } from './api-priority-level.enum';
import { PrioritySheddingConfig } from './priority-shedding.types';

export function resolveApiPriority(
  reflector: Reflector,
  context: ExecutionContext,
  config: PrioritySheddingConfig,
): ApiPriorityLevel {
  const fromHandler = reflector.getAllAndOverride<ApiPriorityLevel | undefined>(
    API_PRIORITY_KEY,
    [context.getHandler(), context.getClass()],
  );
  return fromHandler ?? config.defaultPriority;
}
```

Add env keys to `src/common/config/env.schema.ts` (after inbound bulkhead block):

```typescript
  INBOUND_PRIORITY_SHEDDING_ENABLED: { required: false },
  INBOUND_DEFAULT_API_PRIORITY: { required: false },
  INBOUND_PRIORITY_SHED_CRITICAL_AT: { required: false },
  INBOUND_PRIORITY_SHED_HIGH_AT: { required: false },
  INBOUND_PRIORITY_SHED_NORMAL_AT: { required: false },
  INBOUND_PRIORITY_SHED_LOW_AT: { required: false },
```

- [ ] **Step 4: Run parse test — expect PASS**

Run: `pnpm exec jest src/core/overload/tests/parse-priority-shedding-config.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

- [ ] **Step 5: Commit**

```bash
git add src/core/overload/priority/parse-priority-shedding-config.ts src/core/overload/priority/resolve-api-priority.ts src/core/overload/decorators/api-priority.decorator.ts src/core/overload/overload.constants.ts src/core/overload/tests/parse-priority-shedding-config.spec.ts src/common/config/env.schema.ts
git commit -m "feat(overload): parse priority shedding config and ApiPriority decorator"
```

---

### Task 3: `PriorityShedRejectedError` and telemetry

**Files:**
- Create: `src/core/overload/errors/priority-shed-rejected.error.ts`
- Modify: `src/core/overload/overload-telemetry.ts`
- Modify: `src/core/telemetry/telemetry.types.ts`
- Modify: `src/common/filters/all-exceptions.filter.ts`
- Modify: `src/common/filters/all-exceptions.filter.spec.ts`

**Interfaces:**
- **Produces:** `PriorityShedRejectedError`, `recordApiPriorityShed503(path)`, filter maps shed error to 503 + shed metric (not bulkhead).

- [ ] **Step 1: Write failing filter test**

Add to `src/common/filters/all-exceptions.filter.spec.ts`:

```typescript
import { PriorityShedRejectedError } from '../../core/overload/errors/priority-shed-rejected.error';
import * as overloadTelemetry from '../../core/overload/overload-telemetry';

it('maps PriorityShedRejectedError to 503 with Retry-After and api_priority_shed metric', () => {
  const recordSpy = jest.spyOn(overloadTelemetry, 'recordApiPriorityShed503');
  const response = { header: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/reports' }),
    }),
  };
  filter.catch(new PriorityShedRejectedError(), host as never);
  expect(response.status).toHaveBeenCalledWith(503);
  expect(recordSpy).toHaveBeenCalledWith('/reports');
  recordSpy.mockRestore();
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm exec jest src/common/filters/all-exceptions.filter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

- [ ] **Step 3: Implement error, telemetry, filter branch**

Create `src/core/overload/errors/priority-shed-rejected.error.ts`:

```typescript
export class PriorityShedRejectedError extends Error {
  constructor() {
    super('Service unavailable: request priority shed under load');
    this.name = 'PriorityShedRejectedError';
  }
}
```

Extend `src/core/telemetry/telemetry.types.ts`:

```typescript
export type ServiceUnavailableReason =
  | 'under_pressure'
  | 'inbound_bulkhead'
  | 'api_priority_shed'
  | 'graphql_concurrency'
  | 'health_check'
  | 'dependency_unavailable';
```

Add to `src/core/overload/overload-telemetry.ts`:

```typescript
export function recordApiPriorityShed503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'api_priority_shed',
    path,
  });
}
```

Update `all-exceptions.filter.ts` — before `mapOverloadException`, add:

```typescript
import { PriorityShedRejectedError } from '../../core/overload/errors/priority-shed-rejected.error';
import { recordApiPriorityShed503 } from '../../core/overload/overload-telemetry';

// inside catch(), after deadline mapping:
const priorityShedMapped = this.mapPriorityShedException(exception);
if (priorityShedMapped) {
  status = priorityShedMapped.status;
  message = priorityShedMapped.message;
  this.setRetryAfterHeader(response, priorityShedMapped.retryAfterSec);
  recordApiPriorityShed503(httpAdapter.getRequestUrl(request));
} else {
  const overloadMapped = this.mapOverloadException(exception);
  // ... existing bulkhead branch (only when not priority shed)
}
```

Add private method:

```typescript
private mapPriorityShedException(
  exception: unknown,
): { status: number; message: string; retryAfterSec: number } | null {
  if (!(exception instanceof PriorityShedRejectedError)) {
    return null;
  }
  return {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: exception.message,
    retryAfterSec: resolveOverloadRetryAfterSec(),
  };
}
```

Ensure **`OverloadRejectedError`** branch does **not** run for **`PriorityShedRejectedError`**.

- [ ] **Step 4: Run filter spec — expect PASS**

Run: `pnpm exec jest src/common/filters/all-exceptions.filter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

- [ ] **Step 5: Commit**

```bash
git add src/core/overload/errors/priority-shed-rejected.error.ts src/core/overload/overload-telemetry.ts src/core/telemetry/telemetry.types.ts src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.spec.ts
git commit -m "feat(overload): 503 mapping and metrics for API priority shed"
```

---

### Task 4: `InboundPriorityBulkheadGuard` (replaces middleware registration)

**Files:**
- Create: `src/core/overload/guards/inbound-priority-bulkhead.guard.ts`
- Modify: `src/core/overload/overload.module.ts`
- Modify: `src/core/overload/inbound-bulkhead.service.ts`
- Create: `src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- **Consumes:** `InboundBulkheadService`, `parsePrioritySheddingConfig`, `resolveApiPriority`, `shouldShedPriorityRequest`, `SkipInboundBulkhead`, `isPressureExemptPath`.
- **Produces:** `InboundPriorityBulkheadGuard` registered as **`APP_GUARD`** (first in provider list so shedding runs before JWT/rate limit work).

- [ ] **Step 1: Write failing guard unit test**

Create `src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts`:

```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InboundPriorityBulkheadGuard } from '../guards/inbound-priority-bulkhead.guard';
import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { PriorityShedRejectedError } from '../errors/priority-shed-rejected.error';
import { OverloadRejectedError } from '../errors/overload-rejected.error';
import { API_PRIORITY_KEY } from '../overload.constants';

function mockContext(url: string, priority?: ApiPriorityLevel): ExecutionContext {
  const finishHandlers: Array<() => void> = [];
  const res = {
    raw: {
      once: (event: string, cb: () => void) => {
        if (event === 'finish' || event === 'close') {
          finishHandlers.push(cb);
        }
      },
    },
    emitFinish: () => finishHandlers.forEach((cb) => cb()),
  };
  const handler = priority !== undefined ? () => undefined : () => undefined;
  const reflector = new Reflector();
  if (priority !== undefined) {
    Reflect.defineMetadata(API_PRIORITY_KEY, priority, handler);
  }
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class MockController {},
    switchToHttp: () => ({
      getRequest: () => ({ url }),
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('InboundPriorityBulkheadGuard', () => {
  const sheddingConfig = {
    enabled: true,
    defaultPriority: ApiPriorityLevel.Normal,
    thresholds: {
      critical: 1,
      high: 0.95,
      normal: 0.85,
      low: 0.7,
    },
  };

  it('sheds low priority before hard cap', () => {
    const bulkhead = new InboundBulkheadService({ enabled: true, maxInFlight: 100 });
    for (let i = 0; i < 70; i += 1) {
      bulkhead.tryAcquire();
    }
    const guard = new InboundPriorityBulkheadGuard(
      bulkhead,
      new Reflector(),
      sheddingConfig,
    );
    expect(() =>
      guard.canActivate(mockContext('/export', ApiPriorityLevel.Low)),
    ).toThrow(PriorityShedRejectedError);
  });

  it('throws OverloadRejectedError at hard cap for critical', () => {
    const bulkhead = new InboundBulkheadService({ enabled: true, maxInFlight: 2 });
    bulkhead.tryAcquire();
    bulkhead.tryAcquire();
    const guard = new InboundPriorityBulkheadGuard(
      bulkhead,
      new Reflector(),
      sheddingConfig,
    );
    expect(() =>
      guard.canActivate(mockContext('/auth/refresh', ApiPriorityLevel.Critical)),
    ).toThrow(OverloadRejectedError);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm exec jest src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

- [ ] **Step 3: Implement guard and wire module**

Add optional helper on service (`src/core/overload/inbound-bulkhead.service.ts`):

```typescript
getUtilization(): number {
  return this.active / this.config.maxInFlight;
}
```

Create `src/core/overload/guards/inbound-priority-bulkhead.guard.ts`:

```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { get } from 'lodash';
import type { ServerResponse } from 'http';
import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { OverloadRejectedError } from '../errors/overload-rejected.error';
import { PriorityShedRejectedError } from '../errors/priority-shed-rejected.error';
import { isPressureExemptPath } from '../is-pressure-exempt-path';
import { SKIP_INBOUND_BULKHEAD_KEY, PRIORITY_SHEDDING_OPTIONS } from '../overload.constants';
import { resolveApiPriority } from '../priority/resolve-api-priority';
import { shouldShedPriorityRequest } from '../priority/should-shed-priority-request';
import { PrioritySheddingConfig } from '../priority/priority-shedding.types';

@Injectable()
export class InboundPriorityBulkheadGuard implements CanActivate {
  constructor(
    private readonly bulkhead: InboundBulkheadService,
    private readonly reflector: Reflector,
    @Inject(PRIORITY_SHEDDING_OPTIONS)
    private readonly sheddingConfig: PrioritySheddingConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    if (!this.bulkhead.isEnabled()) {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_INBOUND_BULKHEAD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{ url?: string }>();
    const url = typeof req.url === 'string' ? req.url : '';
    if (isPressureExemptPath(url)) {
      return true;
    }

    const priority = resolveApiPriority(this.reflector, context, this.sheddingConfig);

    if (
      this.sheddingConfig.enabled &&
      shouldShedPriorityRequest({
        active: this.bulkhead.activeCount,
        maxInFlight: this.bulkhead.maxInFlight,
        priority,
        thresholds: this.sheddingConfig.thresholds,
      })
    ) {
      throw new PriorityShedRejectedError();
    }

    if (!this.bulkhead.tryAcquire()) {
      throw new OverloadRejectedError();
    }

    this.attachRelease(context);
    return true;
  }

  private attachRelease(context: ExecutionContext): void {
    const res = context.switchToHttp().getResponse<ServerResponse>();
    const raw = get(res, 'raw', res) as ServerResponse;
    let released = false;
    const releaseOnce = (): void => {
      if (released) {
        return;
      }
      released = true;
      this.bulkhead.release();
    };
    raw.once('finish', releaseOnce);
    raw.once('close', releaseOnce);
  }
}
```

Update `src/core/overload/overload.module.ts`:

```typescript
import { parsePrioritySheddingConfig } from './priority/parse-priority-shedding-config';
import { PRIORITY_SHEDDING_OPTIONS } from './overload.constants';
import { InboundPriorityBulkheadGuard } from './guards/inbound-priority-bulkhead.guard';

// inside forRoot():
const shedding = parsePrioritySheddingConfig();
providers: [
  // ... existing INBOUND_BULKHEAD_OPTIONS ...
  { provide: PRIORITY_SHEDDING_OPTIONS, useValue: shedding },
  InboundPriorityBulkheadGuard,
],
exports: [InboundPriorityBulkheadGuard, /* existing */],
```

Update `src/app.module.ts`:

1. Import `InboundPriorityBulkheadGuard` from `./core/overload`.
2. Add **`APP_GUARD`** provider **before** `JwtAuthGuard`:

```typescript
{
  provide: APP_GUARD,
  useClass: InboundPriorityBulkheadGuard,
},
```

3. Remove **`InboundBulkheadMiddleware`** from the middleware chain (keep `InboundBulkheadMiddleware` export for backwards compatibility; guard is the single admission point).

- [ ] **Step 4: Run guard + existing bulkhead tests**

Run: `pnpm exec jest src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts src/core/overload/tests/inbound-bulkhead.service.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/overload/guards/inbound-priority-bulkhead.guard.ts src/core/overload/overload.module.ts src/core/overload/inbound-bulkhead.service.ts src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts src/app.module.ts
git commit -m "feat(overload): priority-aware inbound bulkhead guard"
```

---

### Task 5: Annotate critical routes and GraphQL default

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Modify: `src/app.module.ts` (GraphQL `/graphql` class-level priority if using dedicated resolver controller — otherwise document default Normal)
- Modify: `src/core/overload/index.ts` (re-exports)

**Interfaces:**
- **Consumes:** `ApiPriority`, `ApiPriorityLevel`.

- [ ] **Step 1: Mark auth as Critical**

At top of `src/auth/auth.controller.ts`:

```typescript
import { ApiPriority } from '@/core/overload';
import { ApiPriorityLevel } from '@/core/overload/priority/api-priority-level.enum';

@ApiPriority(ApiPriorityLevel.Critical)
@Controller('auth')
export class AuthController {
```

- [ ] **Step 2: Export public API from overload index**

Add to `src/core/overload/index.ts`:

```typescript
export { ApiPriority } from './decorators/api-priority.decorator';
export { ApiPriorityLevel } from './priority/api-priority-level.enum';
export { InboundPriorityBulkheadGuard } from './guards/inbound-priority-bulkhead.guard';
export { PriorityShedRejectedError } from './errors/priority-shed-rejected.error';
export { parsePrioritySheddingConfig } from './priority/parse-priority-shedding-config';
```

- [ ] **Step 3: Run targeted tests + compile**

Run: `pnpm exec jest src/core/overload src/common/filters/all-exceptions.filter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Run: `pnpm exec tsc -p tsconfig.json --noEmit`

Expected: PASS / no errors

- [ ] **Step 4: Commit**

```bash
git add src/auth/auth.controller.ts src/core/overload/index.ts
git commit -m "feat(overload): mark auth routes critical priority"
```

---

### Task 6: Docs, `.env.example`, and ops alarms

**Files:**
- Modify: `.env.example`
- Modify: `docs/operations/edge-vs-app-rate-limits.md`
- Modify: `docs/operations/cloudwatch-overload-alerts.md`
- Modify: `docs/features/features.md`

- [ ] **Step 1: Document env vars in `.env.example`**

After inbound bulkhead block:

```bash
# API priority shedding (requires INBOUND_BULKHEAD_ENABLED=true)
INBOUND_PRIORITY_SHEDDING_ENABLED=false
INBOUND_DEFAULT_API_PRIORITY=normal
INBOUND_PRIORITY_SHED_LOW_AT=0.7
INBOUND_PRIORITY_SHED_NORMAL_AT=0.85
INBOUND_PRIORITY_SHED_HIGH_AT=0.95
INBOUND_PRIORITY_SHED_CRITICAL_AT=1
```

- [ ] **Step 2: Update edge vs app decision table**

In `docs/operations/edge-vs-app-rate-limits.md`, add row:

| **API priority shed** | Per-VM utilization tiers (`@ApiPriority`) | `INBOUND_PRIORITY_SHEDDING_*`, `InboundPriorityBulkheadGuard` | **503** + `Retry-After` (overload) |

Add decision row:

| Low-priority API shed under load (not yet at hard cap) | Priority shedding | **503** | Retry; prefer delaying batch/export traffic |

Update bulkhead row to note admission is via **guard** (not middleware).

- [ ] **Step 3: CloudWatch alarm recipe**

In `docs/operations/cloudwatch-overload-alerts.md`, add:

| `api_priority_shed` | `InboundPriorityBulkheadGuard` / `PriorityShedRejectedError` |

Alarm: `Reason=api_priority_shed`, threshold ≥ **20** / 5 min → review batch endpoints and thresholds.

- [ ] **Step 4: Update features.md status**

Change:

| API priority + load shedding | **Missing** | — |

to:

| API priority + load shedding | **Done** | `@ApiPriority`, `InboundPriorityBulkheadGuard`, EMF `Reason=api_priority_shed` |

Change Backpressure row note: remove “API priority queues still missing”.

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/operations/edge-vs-app-rate-limits.md docs/operations/cloudwatch-overload-alerts.md docs/features/features.md
git commit -m "docs: API priority shedding ops and feature status"
```

---

### Task 7: Regression sweep

- [ ] **Step 1: Run overload + filter test suite**

Run: `pnpm exec jest src/core/overload src/common/filters/all-exceptions.filter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 2: Run full unit tests (optional but recommended before merge)**

Run: `pnpm test -- --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 3: Manual smoke (local)**

1. Set in `.env`: `INBOUND_BULKHEAD_ENABLED=true`, `INBOUND_MAX_IN_FLIGHT=10`, `INBOUND_PRIORITY_SHEDDING_ENABLED=true`.
2. Start app: `pnpm start:dev`.
3. Confirm `/health` → **200**.
4. Use parallel requests (e.g. `hey -n 20 -c 20 http://localhost:3000/api/...`) — low-priority route should see **503** before critical `/auth` routes when load is mixed.

---

## Self-review

| Requirement | Task |
| ----------- | ---- |
| Low → high shedding under load | Task 1, 4 |
| Critical routes protected longer | Task 1 thresholds, Task 5 auth |
| 503 + Retry-After | Task 3, 4 |
| Distinct telemetry from bulkhead hard-cap | Task 3 (`api_priority_shed`) |
| Health exempt | Task 4 (`SkipInboundBulkhead`, `isPressureExemptPath`) |
| Multi-VM per-VM semantics documented | Task 6 |
| No request queues | Global Constraints |
| `@ApiPriority()` for handlers | Task 2, 5 |

**Placeholder scan:** No TBD steps; each task includes concrete code and commands.

**Type consistency:** `ApiPriorityLevel`, `PrioritySheddingConfig`, `PRIORITY_SHEDDING_OPTIONS`, and guard constructor align across Tasks 2–4.

---

## Execution handoff

**Plan complete and saved to** `docs/superpowers/plans/2026-10-29-api-priority-shedding.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks (`superpowers:subagent-driven-development`).

2. **Inline Execution** — execute tasks in this session with checkpoints (`superpowers:executing-plans`).

**Which approach?**
