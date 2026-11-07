# Intent: Heavy-load resilience hardening

Author: agent (draft for owner) · Status: Accepted · Date: 2026-11-08
Lifecycle: DRAFT

## Problem

Under heavy load or a partial Redis/Postgres brownout, several hot paths fail hard instead of degrading:

- `RateLimitGuard` awaits `RedisRateLimitBackend.consume()` with no fallback — a Redis blip turns every request into a 500.
- `CacheService` propagates backend errors — `getOrSet` throws instead of calling the loader.
- `ComplexityPlugin` makes 3–4 unguarded Redis round-trips per GraphQL operation (`incr`/`expire`/`get`/`incrby`/`expire`), non-atomically.
- `JobEnqueueService.enqueue()` fails the caller after the Postgres ledger row is committed if `queue.add()` fails; `JobLeaseReclaimService` never re-queues such orphaned `pending` rows.
- `/health` and `/health/ready` open a new `pg.Client` (and Redis connection) per probe; there is no I/O-free liveness probe. Node's default keep-alive (5s) is shorter than ALB idle timeout (60s) → sporadic 502s.
- Argon2id (64 MB, parallelism 4) runs unbounded; a login burst saturates the libuv threadpool and RSS.

## User and evidence

Primary user: operators deploying this boilerplate on ≥2 VMs behind ALB.
Job to be done: keep serving (possibly degraded) under load spikes and dependency blips.
Current workaround: none; rely on Redis/Postgres never blipping.
Evidence: observed (code audit, 2026-11-08).

## Proposed outcome

Soft dependencies fail open with metrics/logs; hard dependencies fail fast with 503 + `Retry-After`; probes are cheap; CPU-heavy work is bounded.

## Scope

Must: REQ-001 rate-limit fallback, REQ-002 cache fail-open, REQ-003 atomic GraphQL Lua + fail-open, REQ-005 job outbox sweep, REQ-006 probes + keep-alive.
Should: REQ-004 JTI revocation resilience, REQ-007 Argon2 bulkhead.
Later: L1/L2 hybrid cache, unified `PostgresModule` with deadline-aware query cancellation, inbound `Idempotency-Key`, adaptive inbound concurrency, k6 load/chaos suite.
Explicit exclusions: new dependencies; Redis Cluster/Sentinel support; changing default rate-limit policies.

## Outcome

Behavioral success metric: with Redis stopped, non-auth REST routes return 2xx (not 500); `/health/live` stays 200; enqueued jobs created during the outage run after Redis returns.
Product risks: fail-open rate limiting weakens abuse protection during outages (bounded by per-VM memory fallback).
Assumptions requiring validation: per-VM memory limits ≈ `limit / HTTP_CLIENT_INSTANCE_COUNT` are acceptable during Redis outage.

## Affected systems

`src/core/rate-limiter`, `src/core/cache`, `src/common/plugins`, `src/auth`, `src/core/background-jobs`, `src/core/health`, `src/main.ts`, `src/common/config/env.schema.ts`, docs.

## Constraints

pnpm only; no new dependencies; Node 24.9+; health probes stay exempt from guards.

## Open questions

1. REQ-004: should JTI revocation fail **open** on Redis error? Plan defaults to **fail-closed (503)** and makes fail-open opt-in — owner decision (security concession).
2. REQ-004: caching "not revoked" results delays cross-VM logout by up to the TTL. Plan defaults negative-cache TTL to **0 (off)** — owner decision.
3. Risk tier: REQ-004 touches auth → tier 2 (HIGH) requires an accepted architecture gate before that task is built.
