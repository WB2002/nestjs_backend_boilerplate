# Spec: Heavy-load resilience hardening

Source: intent/heavy-load-resilience-hardening/intent.md (accepted 2026-11-08)
Lifecycle: DRAFT

## Requirements

### REQ-001 Rate-limit Redis fallback

Experience: none
Given: `RATE_LIMIT_STORAGE=redis` and `RedisRateLimitBackend.consume()` rejects
When: `RateLimitGuard` consumes a policy
Then: the decision comes from an in-process `MemoryRateLimitBackend` with `limit = max(1, floor(limit / HTTP_CLIENT_INSTANCE_COUNT))`; no 500. After `RATE_LIMIT_FALLBACK_COOLDOWN_MS` (default 5000) the next call retries Redis.
Acceptance criteria: unit test with a throwing Redis backend returns `allowed` results and enforces the scaled limit; a warning log is emitted at most once per cooldown window.

### REQ-002 Cache fail-open

Experience: none
Given: the cache backend or loader lock rejects
When: `get`, `set`, `delete`, or `getOrSet` is called
Then: `get` → `null`; `set`/`delete` resolve; loader-lock errors are treated as "lock not available, run loader"; `getOrSet` returns the loader's value. Loader errors still propagate.

### REQ-003 Atomic GraphQL concurrency and budget

Experience: none
Given: `ComplexityPlugin` enforces `GQL_MAX_CONCURRENCY` and `GQL_USER_BUDGET`
When: an operation starts / resolves
Then: concurrency acquire is one `EVAL` (INCR, EXPIRE, DECR-if-over); budget consume is one `EVAL` (check, INCRBY, EXPIRE 60 on first write). On Redis error both fail open (acquire returns `{ acquired: true, current: 0, degraded: true }`; release skips DECR when `degraded`).

### REQ-004 JTI revocation resilience

Experience: none
Given: `AccessTokenAuthenticator.userFromVerifiedPayload` calls `AuthService.isRevoked(jti)`
When: the JTI was revoked on this VM, or Redis rejects
Then: revoked JTIs are remembered in a bounded in-process map (max 10 000, TTL = `ACCESS_TOKEN_TTL`); optional negative caching via `AUTH_REVOCATION_CACHE_TTL_MS` (default 0 = off). On Redis error: throw `ServiceUnavailableException` (503) unless `AUTH_REVOCATION_FAIL_OPEN=true`, then return `false`.

### REQ-005 Background-job outbox sweep

Experience: none
Given: the Postgres ledger insert succeeded and `queue.add()` rejects
When: `enqueue()` completes, and later `JobLeaseReclaimService.tick()` runs
Then: `enqueue()` returns `{ jobRowId, enqueued: true, deduplicated: false }` and logs a warning; `tick()` also selects `pending` rows with `run_at <= NOW() - BACKGROUND_JOBS_ORPHAN_MIN_AGE_SEC` (default 30) and calls `wakeJobRow` for each (idempotent: skips active/waiting/delayed BullMQ jobs).

### REQ-006 Cheap probes and ALB keep-alive

Experience: none
Given: ALB probes and keep-alive reuse
When: `/health/live`, `/health/ready` are hit, or sockets idle
Then: `GET /health/live` returns 200 without network I/O (503 while shutting down). `/health/ready` and `/health` reuse one `pg.Pool` (`max: 1`) and coalesce dependency checks through a single-flight snapshot cached `HEALTH_CHECK_CACHE_TTL_MS` (default 2000). Fastify uses `keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS` (default 65000) and `headersTimeout = keepAliveTimeout + 1000`.

### REQ-007 Argon2 bulkhead

Experience: none
Given: concurrent `argon2.hash` / `argon2.verify`
When: in-flight hashes reach `AUTH_PASSWORD_HASH_MAX_CONCURRENT` (default 2)
Then: callers wait up to `min(AUTH_PASSWORD_HASH_MAX_WAIT_MS (default 2000), remainingMs())`; queue length above `AUTH_PASSWORD_HASH_MAX_QUEUE` (default 32) or wait timeout → `OverloadRejectedError` (existing 503 + `Retry-After` mapping).

## Risk tier

Tier: 2 (HIGH) for REQ-004 (auth); 1 (MEDIUM) for the rest.
Why: REQ-004 changes revocation failure semantics.

## Abuse and failure cases

- Redis outage + abuse: memory fallback still enforces per-VM limits.
- Fail-open JTI (opt-in only): a logged-out token stays valid up to `ACCESS_TOKEN_TTL` during an outage.

## Data impact

No schema change; new read query on `background_jobs` (uses existing `status`/`run_at` columns).
