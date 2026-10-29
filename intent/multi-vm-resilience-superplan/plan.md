# Multi-VM Enterprise Resilience Superplan

> **For agentic workers:** This document is a **superplan** (epic breakdown). Each task below gets its **own** implementation plan via the `writing-plans` skill (full TDD steps, code, commands). When implementing a task, use **superpowers:subagent-driven-development** or **superpowers:executing-plans** against that task’s child plan—not this file’s checkboxes alone.

**Goal:** Harden `nestjs_backend_boilerplate` for **≥2 VMs**, **ALB-fronted** deployment, and **enterprise clients** by adding inbound overload admission, fail-fast concurrency caps, HttpClient deadline propagation and cluster-aware downstream limits, GraphQL Redis concurrency hardening, and clear edge-vs-app rate-limit guidance—without Nginx/Envoy sidecars or replacing `HttpClient` with third-party adaptive limiters (adaptive limiter swap is a **deferred Phase II** epic).

**Architecture:** Keep **ALB → Fastify Nest :3000**. Layer defenses: optional **WAF (volumetric)** → **Redis-backed `RateLimitGuard` (product quotas)** → **`@fastify/under-pressure` (process health)** → **inbound bulkhead (global in-flight, 503 fail-fast)** → handlers → **`HttpClient` (inherits inbound `AbortSignal` + per-instance concurrency budgets)**. GraphQL keeps **Redis** coordination in `ComplexityPlugin` with leak-safe keys. Outbound adaptive concurrency (`gradient-limit` / `fortify-adaptive`) stays **inside** `client-runtime` in a later epic only if fixed limits prove insufficient.

**Tech Stack:** NestJS 11, Fastify 5, `@fastify/under-pressure`, existing `src/core/request-deadline` ALS, `src/core/http-client`, ioredis (rate limit + GraphQL), Jest (`pnpm test`).

## Global Constraints

- **Runtime:** Node **22+** (see `Dockerfile`); package manager **pnpm**; tests via **`pnpm test`** / **`jest --watchman=false`**.
- **HTTP server:** **Fastify** via `@nestjs/platform-fastify`; plugins registered in **`src/main.ts`** (pattern: helmet, cookie, multipart, compress).
- **Multi-VM assumption:** Production always runs **>1 target** behind ALB; **`TRUST_PROXY=true`** in production (`src/main.ts` comment); **`SHUTDOWN_DRAIN_MS`** aligned with ALB deregistration delay.
- **Imports:** Top of file only (no inline imports) per workspace rule.
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Health probes:** `/health`, `/health/ready` must stay exempt from rate limit, request deadline, inbound bulkhead, and under-pressure-induced false negatives where documented (see `src/health/health.controller.ts`: `@SkipRateLimit()`, `@SkipRequestDeadline()`).
- **Overload HTTP semantics:** Prefer **503 Service Unavailable** + **`Retry-After`** (seconds) for saturation shedding; **429** remains for **`RateLimitGuard`** quota abuse.
- **Phase II (out of scope for Tasks 1–7):** Replace internal `ConcurrencyLimiter` with adaptive algorithm behind unchanged `.addConcurrencyLimit()` API.

---

## File map (planned touch surface)

| Area                      | Create                                                                                                                                                     | Modify                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Under-pressure            | `src/core/overload/overload.types.ts`, `src/core/overload/register-under-pressure.ts`, `src/core/overload/index.ts`                                        | `src/main.ts`, `src/common/config/env.schema.ts`, `.env.example` (if present)                                             |
| Inbound bulkhead          | `src/core/overload/inbound-bulkhead.middleware.ts`, `src/core/overload/inbound-bulkhead.service.ts`, `src/core/overload/errors/overload-rejected.error.ts` | `src/app.module.ts` (middleware order), `src/common/filters/all-exceptions.filter.ts`, `env.schema.ts`                    |
| HttpClient deadlines      | `src/core/http-client/resilience/inbound-deadline.ts` (or extend helpers)                                                                                  | `src/core/http-client/runtime/client-runtime.ts`, `src/core/http-client/index.ts`, `docs/features/http_client.feature.md` |
| HttpClient cluster limits | `src/core/http-client/resilience/resolve-max-concurrent.ts`                                                                                                | `src/core/http-client/types/policy.types.ts`, `client-runtime.ts`, `docs/features/http_client.feature.md`                 |
| GraphQL                   | `src/common/plugins/complexity.plugin.spec.ts` (if missing)                                                                                                | `src/common/plugins/complexity.plugin.ts`, `env.schema.ts`, `docs/features/features.md`                                   |
| Multi-VM Redis defaults   | —                                                                                                                                                          | `src/app.module.ts`, `src/common/config/env.schema.ts`, `docs/features/features.md`, ops doc                              |
| Edge vs app limits        | `docs/operations/edge-vs-app-rate-limits.md`                                                                                                               | `docs/features/features.md` (link), optional `docs/operations/alb-multi-vm.md`                                            |

---

## Dependency graph (execution order)

```text
Task 0 (Redis prod defaults)
    ↓
Task 1 (under-pressure) ──┐
    ↓                     ├── Task 2 (inbound bulkhead) depends on shared overload module + exception filter patterns from Task 1
Task 3 (HttpClient cluster concurrency) — independent of 1–2 but same release train
Task 4 (HttpClient deadline propagation) — independent; uses request-deadline helpers
Task 5 (GraphQL Redis hardening) — independent; requires Redis (already required in env)
Task 6 (edge vs app docs) — last; documents Tasks 0–5
Task 7 (Phase II adaptive limiter) — optional future; blocked on Task 3 metrics/ops experience
```

---

### Task 0: Multi-VM Redis coordination (rate limit + cache)

**Child plan file:** `intent/multi-vm-redis-coordination/plan.md`

**Why first:** `AppModule` defaults **`RateLimitStorage.Memory`** and **`CacheStorage.Memory`** (`src/app.module.ts:88–90`). On N VMs, quotas and cache are **N×** effective—unacceptable for enterprise tenants.

**Scope IN:**

- Wire **`RateLimiterModule.forRootAsync`** (or factory) so **`NODE_ENV=production`** (or explicit `RATE_LIMIT_STORAGE=redis`) uses **`RateLimitStorage.Redis`** (backend already in `src/core/rate-limiter/rate-limiter.module.ts`).
- Wire **`CacheModule.forRootAsync`** so production uses **`CacheStorage.Redis`** when cache is enabled (mirror rate-limiter pattern in `src/core/cache/`).
- Add env keys to **`src/common/config/env.schema.ts`**: e.g. `RATE_LIMIT_STORAGE`, `CACHE_STORAGE` (optional; validate enum).
- Document enterprise **tenant-first** rate policies (`RateLimitIdentifier.UserId`) vs IP/guest in **`docs/features/features.md`** status notes.
- Tests: module factory unit tests or integration test with mocked `ConfigService`.

**Scope OUT:** Changing default demo limits (`global-ip` 10/min); enterprise tier tables; WAF configuration.

**Acceptance criteria:**

- With `RATE_LIMIT_STORAGE=redis`, two app instances share one counter for the same tracker key (integration or backend test).
- Production-like config never uses memory rate limit unless explicitly opted in (e.g. `NODE_ENV=development`).
- Boot still succeeds if Redis lazy-connect fails for rate limit (existing log behavior preserved).

**Produces for later tasks:**

- Shared Redis expectation for Task 5 and Task 6 documentation.

---

### Task 1: Inbound overload admission (`@fastify/under-pressure`)

**Child plan file:** `intent/inbound-under-pressure/plan.md`

**Prerequisites:** Task 0 recommended (not strictly blocking).

**Scope IN:**

- Add dependency **`@fastify/under-pressure`** (Fastify 5–compatible version per npm).
- Create **`src/core/overload/register-under-pressure.ts`** that registers the plugin on the **`FastifyAdapter`** instance with configurable:
  - `maxEventLoopDelay` (ms)
  - `maxHeapUsedBytes` / `maxRssBytes` (optional)
  - `pressureHandler` returning **503** JSON consistent with `AllExceptionsFilter` shape (or reuse filter via reply).
- Set **`Retry-After`** on pressure responses (fixed seconds from env, e.g. `OVERLOAD_RETRY_AFTER_SEC=5`).
- Env vars in **`env.schema.ts`**: `UNDER_PRESSURE_ENABLED`, thresholds, `OVERLOAD_RETRY_AFTER_SEC`.
- Register in **`src/main.ts`** after adapter creation, **before** `NestFactory.create` listen (same pattern as helmet/compress).
- **`exposeStatusRoute`:** only on admin path or disabled in production (document choice in child plan).
- Exclude **`/health`**, **`/health/ready`** from pressure handling if the plugin supports `bypass` / custom route hook; otherwise document ALB health check path exemption.
- Jest: minimal test via Fastify inject or unit test of `pressureHandler`.

**Scope OUT:** Global in-flight counting (Task 2); Redis global semaphore.

**Acceptance criteria:**

- When event loop delay exceeds threshold, arbitrary route returns **503** + **`Retry-After`**.
- Health routes remain **200/503** based on Terminus/shutdown only, not false-positive pressure during normal load.
- Plugin registration does not break existing **`compress`**, **`multipart`**, GraphQL.

**Interfaces:**

- **Produces:** `registerUnderPressure(fastifyAdapter, config): Promise<void>` exported from `src/core/overload/index.ts`.

---

### Task 2: Global inbound in-flight cap (fail-fast bulkhead)

**Child plan file:** `intent/inbound-bulkhead-fail-fast/plan.md`

**Prerequisites:** Task 1 (shared `src/core/overload/` package and 503 + `Retry-After` exception mapping).

**Scope IN:**

- Implement **process-local** semaphore in **`InboundBulkheadService`**:
  - `maxInFlight` from env (`INBOUND_MAX_IN_FLIGHT`, default e.g. 100).
  - **`maxQueue: 0`** semantics—**no waiting queue**; reject immediately when `active >= maxInFlight`.
- **`InboundBulkheadMiddleware`** as Nest middleware applied in **`AppModule.configure`** **after** `LoggerMiddleware`, **before** or **after** `RequestDeadlineMiddleware` (child plan must pick one order and test: bulkhead before deadline avoids starting timers for rejected requests).
- Skip paths: same as health + `@SkipRateLimit` pattern—add **`@SkipInboundBulkhead()`** decorator + metadata key, apply on **`HealthController`**.
- Throw **`OverloadRejectedError`** (new) mapped in **`AllExceptionsFilter`** to **503** + **`Retry-After`** (reuse constant from Task 1).
- Optional: expose **`bulkhead.stats()`** for future metrics (active, rejected count)—YAGNI unless test needs it.
- Jest: middleware acquire/release on success; 503 when at cap; skip decorator; release on thrown handler error.

**Scope OUT:** Redis cluster-wide in-flight (enterprise optional Phase II); priority queues (roadmap “API priority” remains missing).

**Acceptance criteria:**

- Under synthetic parallel requests, excess requests get **503** without increasing event loop queue depth unboundedly.
- In-flight count returns to zero after requests complete or fail.
- Compatible with **multi-VM**: document that **`INBOUND_MAX_IN_FLIGHT` is per VM**; ALB spreads load; total cluster cap ≈ `N × maxInFlight`.

**Interfaces:**

- **Consumes:** overload retry-after helper from Task 1 (shared util).
- **Produces:** `SkipInboundBulkhead`, `InboundBulkheadMiddleware`, `OverloadRejectedError`.

---

### Task 3: HttpClient cluster-aware fixed concurrency (extend, don’t replace)

**Child plan file:** `intent/http-client-cluster-concurrency/plan.md`

**Prerequisites:** None (parallel with Tasks 1–2).

**Scope IN:**

- Extend **`ConcurrencyLimitPolicy`** in **`src/core/http-client/types/policy.types.ts`**:

```typescript
export interface ConcurrencyLimitPolicy {
  maxConcurrent: number;
  /** When set, effective limit = max(1, floor(maxConcurrent / instanceCount)) */
  clusterAware?: boolean;
}
```

- Add env **`HTTP_CLIENT_INSTANCE_COUNT`** (optional; default `1`) read at runtime in **`resolveEffectiveMaxConcurrent(policy, instanceCount): number`** (`src/core/http-client/resilience/resolve-max-concurrent.ts`).
- Use resolved value in **`ClientRuntime`** constructor instead of raw `policy.concurrencyLimit.maxConcurrent`.
- Document in **`docs/features/http_client.feature.md`**: enterprise deployments set `HTTP_CLIENT_INSTANCE_COUNT` to expected **maximum** task count (or use conservative ASG max) so **sum across VMs ≤ intended global budget**.
- Jest: `resolveEffectiveMaxConcurrent` table tests; existing concurrency spec updated for `clusterAware: true`.
- **Do not** add npm adaptive limiter in this task.

**Scope OUT:** Adaptive limiter (Task 7); Redis distributed semaphore across VMs.

**Acceptance criteria:**

- `.addConcurrencyLimit({ maxConcurrent: 50, clusterAware: true })` with `HTTP_CLIENT_INSTANCE_COUNT=10` yields effective **5** per process.
- Public fluent API unchanged for callers omitting `clusterAware` (backward compatible).

**Interfaces:**

- **Produces:** `resolveEffectiveMaxConcurrent(policy, instanceCount: number): number`.

---

### Task 4: Wire inbound request deadline → outbound HttpClient

**Child plan file:** `intent/http-client-inbound-deadline-propagation/plan.md`

**Prerequisites:** None; uses existing **`getRequestSignal()`** / **`remainingMs()`** from `src/core/request-deadline/helpers/request-deadline.helpers.ts`.

**Scope IN:**

- In **`ClientRuntime.executeLogicalRequest`** (before `createTimeoutBudget`):
  - Read inbound signal via **`getRequestSignal()`** and deadline via **`getDeadlineAt()`**.
  - Merge into outbound request: if caller did not set `request.signal`, attach inbound signal.
  - Cap **`totalTimeoutMs`** / attempt timeouts so they do not exceed **`remainingMs()`** (when defined)—prefer **`min(policy, remainingMs())`** semantics documented in child plan.
- Add helper **`mergeInboundDeadlineWithPolicy(...)`** in **`src/core/http-client/resilience/inbound-deadline.ts`** (pure functions for testability).
- Ensure coalescing path (`coalescer.run`) still propagates merged signal (see `client-runtime.ts:211–227`).
- Abort outbound when inbound deadline fires → surface as existing abort errors, not silent hang.
- Update **`docs/features/http_client.feature.md`** with “inbound deadline inheritance” section.
- Jest: tests with **`DeadlineContext.run`** wrapping `client.get()`; assert outbound abort before inbound deadline.

**Scope OUT:** Propagating `x-request-deadline` header automatically to external systems (optional header copy in separate follow-up).

**Acceptance criteria:**

- Handler with 500ms inbound deadline cancels outbound HTTP attempt when deadline elapses.
- Explicit per-request `timeoutMs` on HttpClient cannot extend beyond inbound remaining budget when inbound ALS is present.
- No regression when ALS empty (background jobs without middleware).

**Interfaces:**

- **Consumes:** `getRequestSignal`, `remainingMs`, `getDeadlineAt` from request-deadline.
- **Produces:** `mergeInboundDeadlineWithPolicy(...)`.

---

### Task 5: GraphQL Redis concurrency hardening (multi-VM)

**Child plan file:** `intent/graphql-redis-concurrency-hardening/plan.md`

**Prerequisites:** Task 0 (Redis required in prod); existing **`ComplexityPlugin`** (`src/common/plugins/complexity.plugin.ts`).

**Scope IN:**

- **Leak safety:** On `incr` for `gql:concurrency:${userId}`, set **`EXPIRE`** (e.g. 300s) on first increment or refresh TTL each op—so crashed workers don’t leave counters elevated forever (budget keys already use 60s TTL; concurrency keys currently **do not**).
- **Anonymous fan-out:** Replace bare `'anonymous'` with stable guest id from request (reuse **`GuestIdMiddleware`** cookie / header resolver pattern) or IP+guest composite key—document enterprise NAT limitation.
- Map **`TOO_MANY_CONCURRENT_REQUESTS`** to HTTP **503** or **429** consistently (child plan picks one; prefer **503** + retry hint for overload vs **429** for quota—align with GraphQL extension code).
- Add **`Retry-After`** on GraphQL HTTP response when concurrency denied (if feasible via Apollo plugin + context).
- Env: `GQL_CONCURRENCY_KEY_TTL_SEC`, document **`GQL_MAX_CONCURRENCY`** per user across all ECS tasks.
- Jest: unit tests with mocked Redis for incr/decr/expire and rejection path.

**Scope OUT:** New GraphQL rate limiter duplicate of `RateLimitGuard`; federation.

**Acceptance criteria:**

- Concurrency key expires after TTL without `decr`.
- Two tasks sharing Redis enforce same user concurrency cap (manual or integration test).
- `willSendResponse` / `didEncounterErrors` still decrement (no double-decr bugs).

---

### Task 6: Edge vs app rate limits (operations documentation)

**Child plan file:** `intent/edge-vs-app-rate-limits/plan.md`

**Prerequisites:** Tasks 0, 1, 2, 5 (document what was built).

**Scope IN:**

- Create **`docs/operations/edge-vs-app-rate-limits.md`** covering:
  - **WAF / ALB:** volumetric abuse, optional enterprise IP allowlists; **do not** mirror `RateLimitGuard` product rules.
  - **App `RateLimitGuard`:** Redis, identifiers (userId primary for enterprise, IP/guest/device secondary), `@RateLimit` / cost decorators.
  - **Under-pressure vs bulkhead vs rate limit** decision table (429 vs 503).
  - **Multi-VM math** for inbound bulkhead and HttpClient `clusterAware`.
- Create **`docs/operations/alb-multi-vm.md`**: `TRUST_PROXY`, target group health **`/health/ready`**, **`SHUTDOWN_DRAIN_MS`**, deregistration delay, no stickiness for JWT.
- Update **`docs/features/features.md`** implementation status rows: Backpressure, Load shedding, Deadline propagation (partial → done where applicable).

**Scope OUT:** Terraform/CDK for WAF; CI/CD (still missing in repo).

**Acceptance criteria:**

- New engineer can configure ALB+ECS+Redis without reading source.
- Clear statement: **no Nginx/Envoy sidecar** for default enterprise deployment.

---

### Task 7 (Phase II, optional): Adaptive concurrency inside `ClientRuntime`

**Child plan file:** `intent/http-client-adaptive-concurrency-phase2/plan.md`

**Prerequisites:** Task 3 shipped and observed in staging/load tests.

**Scope IN:**

- Introduce **`AdaptiveConcurrencyLimiter`** interface matching acquire/release/close of **`ConcurrencyLimiter`**.
- **Vendored in-repo** adaptive limiter (ported from Fortify-TS adaptive `@0.1.0`, MIT)—**no** npm `@klarlabs-studio/*` dependency (see child plan Task 0).
- **`ConcurrencyLimitPolicy` extension:** `mode: 'fixed' | 'adaptive'` with adaptive tuning params.
- Keep **`.addConcurrencyLimit()`** fluent API stable.

**Scope OUT:** Inbound adaptive limits; Envoy.

**Acceptance criteria:**

- Load test shows limit rises under healthy latency and falls under induced latency/errors without manual `maxConcurrent` edits.

---

## Self-review (superplan vs spec)

| Requirement                                     | Task   |
| ----------------------------------------------- | ------ |
| `@fastify/under-pressure`                       | Task 1 |
| Global in-flight fail-fast 503                  | Task 2 |
| Extend HttpClient fixed limits + cluster math   | Task 3 |
| Adaptive limiter deferred inside runtime        | Task 7 |
| Inbound deadline → HttpClient                   | Task 4 |
| GraphQL Redis concurrency multi-VM              | Task 5 |
| Edge WAF vs app RateLimitGuard                  | Task 6 |
| Multi-VM Redis rate limit (enterprise implicit) | Task 0 |

**Placeholder scan:** No TBD implementation steps in this superplan; child plans must contain full code/commands.

---

## Suggested child plan creation order

1. `2026-10-28-multi-vm-redis-coordination.md`
2. `2026-10-28-inbound-under-pressure.md`
3. `2026-10-28-inbound-bulkhead-fail-fast.md`
4. `2026-10-28-http-client-inbound-deadline-propagation.md`
5. `2026-10-28-http-client-cluster-concurrency.md` (can swap with 4)
6. `2026-10-28-graphql-redis-concurrency-hardening.md`
7. `2026-10-28-edge-vs-app-rate-limits.md`
8. (Later) `2026-10-28-http-client-adaptive-concurrency-phase2.md`

---

## Execution handoff

**Superplan saved to:** `intent/multi-vm-resilience-superplan/plan.md`

**Next step:** Run **`/writing-plans`** (or ask the agent) for **Task 0** first; paste “Implement Task 0 from `2026-10-28-multi-vm-resilience-superplan.md`”.

**Two execution options for each child plan:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks (`superpowers:subagent-driven-development`).
2. **Inline Execution** — same session, batched steps (`superpowers:executing-plans`).

**Which task’s detailed plan do you want generated first?**
