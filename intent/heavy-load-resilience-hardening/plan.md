# Heavy-Load Resilience Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Source: intent/heavy-load-resilience-hardening/spec.md
Experience: none
Lifecycle: DRAFT

**Goal:** Make Redis/Postgres blips and load spikes degrade the API gracefully instead of turning into 500s, probe stampedes, or threadpool starvation.

**Architecture:** Wrap each soft Redis dependency in fail-open behavior at its existing seam (rate-limit backend, cache service, GraphQL concurrency helpers). Revocation keeps fail-closed by default, with opt-in fail-open. Jobs use the Postgres ledger as the outbox; the existing reclaim timer sweeps orphaned `pending` rows. Probes get an I/O-free liveness route and a cached, pooled readiness snapshot. Argon2 sits behind the existing `ConcurrencyLimiter` from `@/core/http-client`.

**Tech Stack:** NestJS 12, Fastify 5, ioredis, pg, BullMQ, argon2, Jest.

**Spec:** [spec.md](spec.md) · [intent.md](intent.md)

## Global Constraints

- Node 24.9+, pnpm only. **No new dependencies.** Never hand-edit `package.json` or `pnpm-lock.yaml`.
- `@/` imports, named exports, barrels (`dto/`, `types/`); imports at top of file.
- Unions and enums end their switches with a `never` default. No empty `catch`: every catch logs or records a metric.
- Tests go in `src/**/tests/*.spec.ts` and run without Docker.
- Boolean names use `is/has/should` prefixes (ESLint enforces this).
- Each new env key goes into `src/common/config/env.schema.ts` (`required: false`) and `.env.example`.
- Health routes stay exempt from every guard (existing decorators).
- Overload is **503 + `Retry-After`**. Quota is **429**.
- Per-task gate: `pnpm quality:lint && pnpm quality:types && pnpm test:unit`.

## Review Focus

1. **Redis recovers mid-cooldown (Task 1):** the next call after the cooldown goes back to Redis. Tested.
2. **Cache loader throws while Redis is down (Task 2):** the loader error still reaches the caller and is not swallowed. Tested.
3. **GraphQL release after a degraded acquire (Task 3):** no `DECR` runs, so the counter can't go negative. Tested.
4. **Duplicate wake of a row already in BullMQ (Task 5):** `wakeJobRow` is a no-op for waiting/active/delayed jobs. Covered by the existing test, re-asserted for the orphan path.
5. **Concurrent readiness probes while Postgres hangs (Task 6):** one in-flight probe, and the `pg` connect times out after 2 s. Tested.

## Human gates (stop points)

- `intent.md` and `spec.md` are **draft**. A human must accept them before Task 1 starts.
- **Task 4 is tier 2 (auth).** It needs an accepted `architecture-gate.md` and answers to intent open questions 1–2 before it is built. Tasks 1–3 and 5–7 do not depend on Task 4.

## Files that change

| Task | Create                                                                                                                                                                                 | Modify                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `src/core/rate-limiter/backends/fallback.backend.ts`, `backends/tests/fallback.backend.spec.ts`                                                                                        | `rate-limiter.module.ts`                                                                                                                                          |
| 2    | `src/core/cache/tests/cache.service.fail-open.spec.ts`                                                                                                                                 | `cache.service.ts`                                                                                                                                                |
| 3    | `src/common/plugins/graphql-concurrency/graphql-lua.scripts.ts`, `graphql-concurrency/consume-graphql-budget.ts`                                                                       | `redis-concurrency.ts`, `index.ts`, `complexity.plugin.ts`, `tests/graphql-concurrency.spec.ts`                                                                   |
| 4    | `src/auth/revocation/revoked-jti.cache.ts`, `src/auth/tests/revoked-jti.cache.spec.ts`, `src/auth/tests/auth.service.revocation.spec.ts`                                               | `auth.service.ts`                                                                                                                                                 |
| 5    | —                                                                                                                                                                                      | `job-enqueue.service.ts`, `sql/claim-job.sql.ts`, `postgres-job.repository.ts`, `job-lease-reclaim.service.ts`, `parse-background-jobs-config.ts`, both job specs |
| 6    | `src/core/health/health-snapshot.ts`, `tests/health-snapshot.spec.ts`, `src/common/config/parse-http-server-timeouts.ts`, `src/common/config/tests/parse-http-server-timeouts.spec.ts` | `health.controller.ts`, `health.module.ts`, `tests/health.controller.spec.ts`, `src/main.ts`                                                                      |
| 7    | `src/auth/password/password-hash-bulkhead.ts`, `src/auth/tests/password-hash-bulkhead.spec.ts`                                                                                         | `auth.service.ts`, `auth.module.ts`                                                                                                                               |
| all  | —                                                                                                                                                                                      | `env.schema.ts`, `.env.example`, `docs/features/features.md`, `docs/operations/alb-multi-vm.md`, `docs/features/background_jobs.feature.md`, `intent/README.md`   |

## Order of work

Tasks 1, 2, 3, 5, 6 and 7 are independent. Suggested order: 1 → 2 → 3 → 5 → 6 → 7, then 4 once its gate is accepted.

---

### Task 1: Rate-limit Redis fallback (REQ-001)

**Files:** see table.

**Interfaces:**

- Produces: `class FallbackRateLimitBackend implements RateLimitBackend` with `constructor(primary: RateLimitBackend, fallback: RateLimitBackend, options: { instanceCount: number; cooldownMs: number; nowMs?: () => number })`
- Consumes: `parseHttpClientInstanceCount` from `@/core/http-client/resilience/parse-http-client-instance-count`, `MemoryRateLimitBackend`.

- [ ] **Step 1: Write failing tests** in `backends/tests/fallback.backend.spec.ts`:
  - `uses primary when healthy`: primary `consume` resolves `{allowed:true,remaining:9,resetMs:1000,retryAfterMs:0}` → result equals it, fallback not called.
  - `falls back with scaled limit when primary throws`: primary rejects `new Error('ECONNREFUSED')`, `instanceCount: 2`, context `limit: 10` → fallback called with `expect.objectContaining({ limit: 5 })`.
  - `scaled limit never below 1`: `limit: 1, instanceCount: 4` → fallback receives `limit: 1`.
  - `skips primary during cooldown, retries after`: fake `nowMs`. Failure at t=0. Call at t=1000 → primary not called. Call at t=5001 (`cooldownMs: 5000`) → primary called again.
  - `quit closes both`: both `quit` mocks called.
- [ ] **Step 2:** `pnpm exec jest --config jest.config.ts src/core/rate-limiter/backends/tests/fallback.backend.spec.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `FallbackRateLimitBackend`.** Track `degradedUntilMs`. On primary error, log a warning via `Logger` once per degraded window and set `degradedUntilMs = now + cooldownMs`. Then call `fallback.consume({ ...ctx, limit: Math.max(1, Math.floor(ctx.limit / instanceCount)) })`. Scale `burst` the same way when it is set.
- [ ] **Step 4: Wire it in `RateLimiterModule.createBackendProvider()`** (Redis branch): `new FallbackRateLimitBackend(new RedisRateLimitBackend(redis), new MemoryRateLimitBackend(), { instanceCount: parseHttpClientInstanceCount(configService.get('HTTP_CLIENT_INSTANCE_COUNT')), cooldownMs: Number(configService.get('RATE_LIMIT_FALLBACK_COOLDOWN_MS') ?? 5000) })`. Add `RATE_LIMIT_FALLBACK_COOLDOWN_MS` to the env schema and `.env.example`. Also set `enableOfflineQueue: false` on that Redis client so errors are immediate.
- [ ] **Step 5:** run the spec plus `src/core/rate-limiter` → PASS. Run the per-task gate.
- [ ] **Step 6: Commit** `feat(rate-limiter): fall back to per-VM memory limits when Redis fails`

### Task 2: Cache fail-open (REQ-002)

**Interfaces:** No public signature change to `CacheService`.

- [ ] **Step 1: Write failing tests** in `cache.service.fail-open.spec.ts`. Use a backend whose `get`/`set`/`delete` reject, and a lock whose `tryAcquire` rejects:
  - `get returns null when backend throws` → `await svc.get('k')` is `null`.
  - `set and delete resolve when backend throws`.
  - `getOrSet returns loader value when backend and lock throw`: loader `jest.fn().mockResolvedValue(42)` → `42`, loader called once.
  - `concurrent getOrSet during outage single-flights the loader`: two parallel calls → loader called once.
  - `loader error still propagates`: loader rejects `new Error('db down')` → `getOrSet` rejects with `'db down'`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** in `cache.service.ts`. Add private `safeBackendGet`, `safeBackendSet`, `safeBackendDelete`, `safeTryAcquire` (an error counts as `null`, which means no lock), and `safeRelease`. Each catches, logs `warn` with the key, and returns the fallback value. Route every `this.backend.*` and `this.loaderLock.*` call through them. When `tryAcquire` threw, skip `waitForPeer` and call `executeLoader` directly; polling a dead Redis for 5 s would add latency.
- [ ] **Step 4:** run the new spec plus `src/core/cache/tests` → PASS. Run the per-task gate.
- [ ] **Step 5: Commit** `feat(cache): fail open on backend and loader-lock errors`

### Task 3: Atomic GraphQL concurrency and budget (REQ-003)

**Interfaces:**

- Produces: `GQL_ACQUIRE_CONCURRENCY_LUA`, `GQL_CONSUME_BUDGET_LUA` (strings) in `graphql-lua.scripts.ts`.
- Changes: `acquireRedisConcurrency(redis, key, max, ttlSec): Promise<{ acquired: boolean; current: number; isDegraded: boolean }>`
- Changes: `ConcurrencyReleaseState = { released: boolean; isDegraded?: boolean }`
- Produces: `consumeGraphqlBudget(redis: Redis, key: string, cost: number, budget: number, windowSec: number): Promise<{ allowed: boolean; used: number; isDegraded: boolean }>`

Lua (KEYS[1]=key):

```lua
-- acquire: ARGV max, ttl
local c = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[2])
if c > tonumber(ARGV[1]) then redis.call('DECR', KEYS[1]); return {0, c - 1} end
return {1, c}
-- budget: ARGV cost, budget, window
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return {0, used} end
local n = redis.call('INCRBY', KEYS[1], ARGV[1])
if n == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
return {1, n}
```

- [ ] **Step 1: Update tests** in `tests/graphql-concurrency.spec.ts`. Replace the `incr/decr/expire` mock with an `eval` mock that simulates the scripts. Keep every existing assertion's intent: TTL passed as `ARGV[2]` = 300, over-limit returns `acquired:false`, and release decrements once. Add:
  - `acquire fails open when eval throws` → `{ acquired: true, current: 0, isDegraded: true }`.
  - `release is a no-op after degraded acquire` → `decr` not called.
  - `consumeGraphqlBudget denies over budget` (used 990, cost 20, budget 1000 → `allowed:false, used:990`).
  - `consumeGraphqlBudget fails open when eval throws` → `allowed:true, isDegraded:true`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Use `redis.eval(script, 1, key, ...args)`. In `ComplexityPlugin`, replace the `get`/`incrby`/`expire` block with `consumeGraphqlBudget(redis, budgetKey, complexity, userBudget, 60)`. Keep the existing `OUT_OF_BUDGET` message, which uses `userBudget - used`. Copy `acquired.isDegraded` into `releaseState`.
- [ ] **Step 4:** run the spec plus `pnpm quality:contract` (the SDL is unchanged, so the snapshot should not move) → PASS. Run the per-task gate.
- [ ] **Step 5: Commit** `perf(graphql): atomic Lua concurrency and budget with fail-open`

### Task 4: JTI revocation resilience (REQ-004) — **blocked on architecture gate**

**Interfaces:**

- Produces: `class RevokedJtiCache` with `constructor(options: { maxEntries: number; nowMs?: () => number })`, `markRevoked(jti: string, ttlMs: number): void`, `markNotRevoked(jti: string, ttlMs: number): void`, `lookup(jti: string): boolean | undefined`. Eviction is insertion-order (Map), oldest first.
- Changes: `AuthService.isRevoked(jti)` checks the cache, then Redis. On a Redis error it throws `ServiceUnavailableException('Session validation unavailable')`, or returns `false` when `AUTH_REVOCATION_FAIL_OPEN=true`.

- [ ] **Step 1: Write failing tests:**
  - `revoked-jti.cache.spec.ts`: lookup returns `true` after `markRevoked`; `undefined` after the TTL passes; evicts the oldest entry at `maxEntries`.
  - `auth.service.revocation.spec.ts`: `logout` marks the cache, so a later `isRevoked` returns `true` with no Redis `get`. Redis `get` rejecting → `ServiceUnavailableException`. Same with fail-open env → `false`. When `AUTH_REVOCATION_CACHE_TTL_MS=0`, a `false` result is not cached (a second call hits Redis again).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** In `AuthService`, build the cache with `maxEntries: 10_000`. The revoked TTL is `ACCESS_TOKEN_TTL * 1000`. Add `AUTH_REVOCATION_FAIL_OPEN` and `AUTH_REVOCATION_CACHE_TTL_MS` to the env schema and `.env.example`.
- [ ] **Step 4:** run `src/auth` → PASS. Run the per-task gate.
- [ ] **Step 5: Commit** `feat(auth): local revoked-JTI cache and explicit Redis failure policy`

### Task 5: Background-job outbox sweep (REQ-005)

**Interfaces:**

- Produces: `FIND_ORPHANED_PENDING_JOBS_SQL` and `PostgresJobRepository.findOrphanedPendingJobs(limit: number, minAgeSec: number): Promise<Array<{ id: string; maxAttempts: number }>>`
- Produces: `BackgroundJobsConfig.orphanMinAgeSec: number` (env `BACKGROUND_JOBS_ORPHAN_MIN_AGE_SEC`, default 30)

```sql
SELECT id, max_attempts FROM background_jobs
WHERE status = 'pending'::background_job_status
  AND run_at <= NOW() - make_interval(secs => $2::double precision)
ORDER BY run_at ASC LIMIT $1::int;
```

(No lock is needed. `wakeJobRow` dedupes on BullMQ `jobId = row id`. Delayed BullMQ jobs whose `run_at` is in the future are excluded by the predicate.)

- [ ] **Step 1: Write failing tests:**
  - `job-enqueue.service.spec.ts`: `returns enqueued when queue.add rejects after insert` → `{ jobRowId: 'job-1', enqueued: true, deduplicated: false }`, no throw.
  - `job-lease-reclaim.service.spec.ts`: `wakes orphaned pending rows` → repo `findOrphanedPendingJobs` resolves `[{id:'job-9',maxAttempts:5}]`, so `wakeJobRow('job-9', 5)` is called with `(25, 30)` as the repo args. Also `one failing wake does not stop the batch`.
  - parser spec (if present) or inline: `orphanMinAgeSec` defaults to 30.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Wrap `queue.add` in `enqueue()` with try/catch and `logger.warn`. In `tick()`, after the lease loop, run the orphan loop. Wrap each `wakeJobRow` in try/catch with a warning.
- [ ] **Step 4:** run `src/core/background-jobs` → PASS. Also run `pnpm test:integration` for the background-jobs suite (persistence change). Run the per-task gate.
- [ ] **Step 5: Docs.** Add an "Outbox recovery" paragraph to `background_jobs.feature.md`.
- [ ] **Step 6: Commit** `feat(jobs): treat Postgres ledger as outbox and sweep orphaned pending rows`

### Task 6: Cheap probes and ALB keep-alive (REQ-006)

**Interfaces:**

- Produces: `class HealthSnapshot<T>` with `constructor(ttlMs: number, nowMs?: () => number)`, `get(load: () => Promise<T>): Promise<T>`. It single-flights the load, caches the result for `ttlMs`, and never caches rejections.
- Produces: `parseHttpServerTimeouts(env): { keepAliveTimeoutMs: number; headersTimeoutMs: number }`
- Changes: `HealthController.live()` on `GET /health/live`. The Postgres ping uses a lazily created `pg.Pool({ max: 1, connectionTimeoutMillis: 2000, idleTimeoutMillis: 30000 })`, closed in `onModuleDestroy`.

- [ ] **Step 1: Write failing tests:**
  - `health-snapshot.spec.ts`: two concurrent `get` calls → loader called once. A call within the TTL → cached. After the TTL → reloads. A rejected load is not cached.
  - `health.controller.spec.ts`: `live() returns ok without calling health.check`, and `live() is 503 while shutting down`. `ready()` called twice within the TTL → `health.check` called once.
  - `parse-http-server-timeouts.spec.ts`: defaults are 65000/66000; `HTTP_KEEP_ALIVE_TIMEOUT_MS=30000` gives 30000/31000; invalid input falls back to defaults.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `live()` returns `{ status: 'ok' }` or throws `ServiceUnavailableException` when shutting down. Do not use Terminus here. `check()` and `ready()` wrap `health.check(...)` in the snapshot (`HEALTH_CHECK_CACHE_TTL_MS`, default 2000). The shutdown short-circuit stays uncached. Replace the per-probe `new Client` with the pool. In `main.ts`, pass `keepAliveTimeout` and the parsed values to `FastifyAdapter`. Fastify 5 supports `keepAliveTimeout` directly; set `headersTimeout` via `serverFactory` options or on `app.getHttpServer()` after `listen`, whichever `pnpm quality:types` accepts.
- [ ] **Step 4:** Add the env keys. In `docs/operations/alb-multi-vm.md`: liveness is `/health/live`, the target group checks `/health/ready`, and keep-alive must exceed the ALB idle timeout.
- [ ] **Step 5:** run `src/core/health` (including `health.ready.http.spec.ts`) → PASS. Run the per-task gate.
- [ ] **Step 6: Commit** `feat(health): I/O-free liveness, cached pooled readiness, ALB keep-alive tuning`

### Task 7: Argon2 bulkhead (REQ-007)

**Interfaces:**

- Produces: `@Injectable() class PasswordHashBulkhead` with `run<T>(fn: () => Promise<T>): Promise<T>`, built from `{ maxConcurrent, maxQueue, maxWaitMs }`. It reuses `ConcurrencyLimiter` from `@/core/http-client`.
- Consumes: `remainingMs`, `getRequestSignal` from `@/core/request-deadline`; `OverloadRejectedError` from `@/core/overload`.

- [ ] **Step 1: Write failing tests** in `password-hash-bulkhead.spec.ts`:
  - `limits concurrency`: `maxConcurrent: 2`, three deferred fns → only 2 have started before one resolves.
  - `rejects when queue full`: `maxConcurrent: 1, maxQueue: 0`, second call → `OverloadRejectedError`.
  - `rejects on wait timeout`: `maxWaitMs: 50` with fake timers → `OverloadRejectedError`.
  - `releases the slot when fn throws`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** If `limiter.queuedCount >= maxQueue`, throw. The wait signal is `AbortSignal.any([AbortSignal.timeout(min(maxWaitMs, remainingMs() ?? maxWaitMs)), getRequestSignal()].filter(Boolean))`. Map the limiter's abort error to `OverloadRejectedError`, unless the inbound request signal fired, in which case rethrow so the existing 499/504 mapping applies. Wrap `argon2.hash` and `argon2.verify` in `AuthService` with `bulkhead.run`, and register the provider in `AuthModule`. Add env keys `AUTH_PASSWORD_HASH_MAX_CONCURRENT` (2), `AUTH_PASSWORD_HASH_MAX_QUEUE` (32), `AUTH_PASSWORD_HASH_MAX_WAIT_MS` (2000).
- [ ] **Step 4:** run `src/auth` → PASS. Run the per-task gate.
- [ ] **Step 5: Commit** `feat(auth): bound concurrent Argon2 work with an overload-aware bulkhead`

---

## Risks

- Fail-open rate limiting during an outage is per VM only (accepted in intent; scaled by instance count).
- Lua scripts change the GraphQL Redis call shape, so existing integration tests may assume `incr`. Run `pnpm test:integration` after Task 3.
- `headersTimeout` wiring depends on the Fastify/Nest adapter API. Task 6, Step 3 allows either approach.

## Proof

Per task: the targeted spec, then `pnpm quality:lint`, `pnpm quality:types`, `pnpm test:unit`. After Tasks 3 and 5: `pnpm test:integration`. Final: `scripts/verify.sh`. Manual chaos check: `docker compose stop redis`, then curl a public REST route (expect 2xx), `/health/live` (200), and `/health/ready` (503).

## Departures from plan

(append during build)

## Rollback

Each task is one commit; `git revert <sha>` and redeploy (minutes). The env defaults keep behavior safe: revocation stays fail-closed, and the orphan sweep is idempotent.

## Flag and rollout

Task 4 (tier 2): `AUTH_REVOCATION_FAIL_OPEN=false` by default, so fail-open rollout is a deliberate env flip. All other tasks are on by default. Tunables: `RATE_LIMIT_FALLBACK_COOLDOWN_MS`, `HEALTH_CHECK_CACHE_TTL_MS`, `BACKGROUND_JOBS_ORPHAN_MIN_AGE_SEC`, `AUTH_PASSWORD_HASH_*`.

## Observability

Warn logs: `rate-limit fallback engaged`, `cache backend degraded`, `graphql concurrency degraded`, `queue.add failed; row will be swept`, `orphaned pending jobs woken: N`. Password-hash overload uses the existing 503 EMF (`inbound_bulkhead` reason through `OverloadRejectedError`). A dedicated `password_hash_bulkhead` reason is Later.

## Docs impact

`docs/features/features.md` (Graceful degradation Partial → Done; health row adds `/health/live`); `docs/operations/alb-multi-vm.md`; `docs/features/background_jobs.feature.md`; `.env.example`; `intent/README.md` index row.

## Definition of done

- Every REQ-001…007 has a test that fails without its change.
- The diff traces to REQ ids. No drive-by edits.
- Lint, types, and unit tests pass; integration passes after Tasks 3 and 5; `scripts/verify.sh` is green.
- Reviews by readonly agents (architect, security-reviewer for Task 4, performance-reviewer, code-reviewer). The builder does not review its own work.
