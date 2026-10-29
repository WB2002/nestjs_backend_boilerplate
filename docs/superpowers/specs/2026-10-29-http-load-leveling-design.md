# HTTP Load Leveling (Bounded Admission Queue) — Design

**Status:** Approved for implementation (extracted from combined roadmap Epic C).

**Related:** [API priority shedding plan](../plans/2026-10-29-api-priority-shedding.md), [edge vs app rate limits](../../operations/edge-vs-app-rate-limits.md), combined roadmap [OTel / deadline / load leveling](../plans/2026-10-29-otel-redaction-deadline-header-http-load-leveling.md).

## Problem

Today, when `INBOUND_BULKHEAD_ENABLED=true` and in-flight requests reach `INBOUND_MAX_IN_FLIGHT`, **`InboundPriorityBulkheadGuard`** fails fast with **`OverloadRejectedError`** (503). That protects the VM but offers no brief wait for a slot to open—clients must retry immediately even when capacity frees within milliseconds.

Background work already uses queue-based load leveling (BullMQ). HTTP admission has no equivalent delay tier.

## Goal

Add an **optional**, **bounded**, **priority-aware** wait queue in front of the inbound bulkhead hard cap. When enabled, requests at capacity may wait up to a configured budget for a slot instead of immediate 503. Queue full or wait timeout still returns **503** + **`Retry-After`** (overload semantics, not 429).

## Non-goals

- Cluster-wide HTTP queuing (remains per-VM, like the bulkhead counter).
- Changing **`InboundBulkheadMiddleware`** (legacy; **`APP_GUARD`** admission is the supported path).
- Outbound HttpClient adaptive/concurrency queues (separate feature).
- Automatic enablement in production (default **off**).

## Architecture

```text
Request → InboundPriorityBulkheadGuard
            ├─ exempt path / skip decorator → pass
            ├─ priority shedding (unchanged) → 503 shed
            └─ acquire slot
                 ├─ active < max → active++, pass
                 ├─ load leveling off → OverloadRejectedError (503 bulkhead)
                 └─ load leveling on → enqueue (priority, FIFO within priority)
                      ├─ queue full → LoadLevelQueueFullError (503)
                      ├─ wait timeout / deadline abort → LoadLevelWaitTimeoutError / RequestCancelledError
                      └─ slot handed off on release → pass
```

### Slot handoff (no lost wakeups)

`InboundBulkheadService.release()` decrements `active`, then if load leveling is enabled and the queue has waiters, **atomically** increments `active` and resolves the highest-priority waiter. The waiter does **not** call `tryAcquire()` again—the slot is already reserved when the enqueue promise resolves. This avoids races with concurrent synchronous arrivals.

### Priority ordering

Waiters sort by **`(ApiPriorityLevel asc, enqueuedAt asc)`**—same priority enum as shedding (`Critical = 0` is highest).

### Wait budget

Guard computes:

```typescript
maxWaitMs =
  budget === undefined
    ? configuredMaxWaitMs
    : Math.min(configuredMaxWaitMs, budget);
```

where `budget` comes from **`remainingMs()`** (inbound request deadline ALS). Pass **`getRequestSignal()`** into the queue so deadline cancellation aborts the wait with existing **`RequestCancelledError`** mapping.

### Configuration (env)

| Variable                         | Default | Meaning                                           |
| -------------------------------- | ------- | ------------------------------------------------- |
| `INBOUND_LOAD_LEVELING_ENABLED`  | `false` | Master switch                                     |
| `INBOUND_LOAD_LEVEL_MAX_QUEUE`   | `100`   | Max waiters when at bulkhead cap                  |
| `INBOUND_LOAD_LEVEL_MAX_WAIT_MS` | `2000`  | Max wait per request                              |
| `INBOUND_LOAD_LEVEL_POLL_MS`     | `25`    | Timer granularity for wait timeout / abort checks |

Load leveling requires bulkhead enabled; if bulkhead is disabled, load leveling is a no-op.

### HTTP / observability

| Condition                    | Exception                   | HTTP              | EMF `Reason`                      |
| ---------------------------- | --------------------------- | ----------------- | --------------------------------- |
| Hard cap, leveling off       | `OverloadRejectedError`     | 503 + Retry-After | `inbound_bulkhead` (unchanged)    |
| Queue full                   | `LoadLevelQueueFullError`   | 503 + Retry-After | `inbound_load_level_queue_full`   |
| Wait timeout                 | `LoadLevelWaitTimeoutError` | 503 + Retry-After | `inbound_load_level_wait_timeout` |
| Deadline abort while waiting | `RequestCancelledError`     | 499 (existing)    | (existing deadline metrics)       |

Health paths (`/health`, `/health/ready`) and `@SkipInboundBulkhead()` remain exempt (unchanged).

## Components

| Unit                                         | Responsibility                                  |
| -------------------------------------------- | ----------------------------------------------- |
| `parse-inbound-load-level-config.ts`         | Pure env parsing                                |
| `InboundLoadLevelQueue`                      | Priority queue, wait/timeout/abort              |
| `InboundBulkheadService`                     | Counter + queue integration + `async acquire()` |
| `InboundPriorityBulkheadGuard`               | Async `canActivate`, wait budget + signal       |
| `AllExceptionsFilter` + `overload-telemetry` | 503 mapping + EMF reasons                       |
| Docs / `.env.example`                        | Operator guidance                               |

## Testing strategy

- Unit: parser, queue (priority, full, timeout, abort), bulkhead acquire/release handoff, guard async paths, filter EMF reasons.
- Run: `pnpm test:unit -- src/core/overload` and filter specs.

## Rollout

Opt-in via `INBOUND_LOAD_LEVELING_ENABLED=true` after bulkhead is tuned. Monitor new EMF reasons separately from `inbound_bulkhead` to distinguish fail-fast vs queue-full vs wait-timeout.
