# Spec: Language-Agnostic Conformance Test Suite & Harness

Source: intent/language-agnostic-conformance-suite/intent.md (accepted 2026-11-10)
Lifecycle: DRAFT

## Requirements

### REQ-001 Production-safe opt-in conformance harness gate

Experience: none
Given: `CONFORMANCE_HARNESS_ENABLED` environment variable
When: `CONFORMANCE_HARNESS_ENABLED` is unset or `'false'`
Then: `ConformanceModule` is not registered in `AppModule` and all `/conformance/*` routes return `404`.
When: `CONFORMANCE_HARNESS_ENABLED === 'true'` and `NODE_ENV === 'production'`
Then: `validateEnv` throws a startup configuration error refusing to enable the conformance harness in production.
When: `CONFORMANCE_HARNESS_ENABLED === 'true'` and `NODE_ENV !== 'production'`
Then: `ConformanceModule` is registered and exposes the `/conformance/*` endpoints described in `REQ-002` through `REQ-006`.
Acceptance criteria: unit tests for `isConformanceHarnessEnabled` and `validateEnv` verify all three branches.

### REQ-002 Conformance cache endpoint (`/conformance/cache`)

Experience: none
Given: `ConformanceModule` is enabled
When: `POST /conformance/cache` is called with `{ key: string, value?: string | null, loaderDelayMs?: number, shouldFailLoader?: boolean, softTtlMs: number, hardTtlMs: number, shouldCacheNull?: boolean, negativeSoftTtlMs?: number, negativeHardTtlMs?: number }`
Then: the handler invokes `CacheService.getOrSet(key, loader, options)` where `loader` increments an internal per-key invocation counter, waits `loaderDelayMs` (default `0`), throws if `shouldFailLoader === true`, and otherwise returns `value ?? null`. The response returns `200` with `{ cachedValue: string | null, loaderCallCount: number, isFromLoader: boolean }`.
When: `DELETE /conformance/cache/:key` is called
Then: `CacheService.delete(key)` is called, the per-key invocation counter is reset, and `200 { deleted: true }` is returned.
Acceptance criteria: unit tests and external conformance tests prove cache hit, SWR background refresh, concurrent single-flight stampede protection (`loaderCallCount === 1` across N parallel requests), and `shouldCacheNull: true` negative caching.

### REQ-003 Conformance outbound HTTP client endpoint (`/conformance/http-client`)

Experience: none
Given: `ConformanceModule` is enabled
When: `POST /conformance/http-client` is called with `{ clientKind: 'internal' | 'external', clientName: string, targetUrl: string, maxRetries?: number, baseDelayMs?: number, circuitBreakerFailureThreshold?: number, circuitBreakerResetTimeoutMs?: number, shouldCoalesce?: boolean, concurrencyMode?: 'fixed' | 'adaptive', maxConcurrent?: number, shouldPropagateDeadline?: boolean, timeoutMs?: number }`
Then:

1. If `targetUrl` is not a loopback HTTP URL (`http://127.0.0.1:<port>/...` or `http://localhost:<port>/...`), reject with `400 Bad Request` (SSRF guard).
2. Build or reuse a keyed `HttpClient` instance (`clientName`) configured with the requested retry, circuit breaker, request coalescing, concurrency limit, and deadline propagation options, perform `GET targetUrl`, and return `200 { upstreamStatus: number, upstreamBody: unknown }`, or map circuit-breaker/timeout/upstream failures into `{ errorName: string, errorMessage: string, statusCode?: number }` with HTTP `502`/`503`/`504` as appropriate.
   Acceptance criteria: unit tests verify loopback SSRF rejection and client option wiring; external conformance tests with a local mock upstream verify retry on `503`, circuit breaker open after threshold, request coalescing of parallel identical GETs, concurrency cap, and `x-request-deadline` header propagation.

### REQ-004 Conformance deadline, priority, and overload endpoints (`/conformance/deadline/slow`, `/conformance/priority/:level`)

Experience: none
Given: `ConformanceModule` is enabled
When: `GET /conformance/deadline/slow?delayMs=<number>` is called
Then: the handler waits up to `delayMs` while listening to `getRequestSignal()`; if the request deadline expires first, `RequestDeadlineInterceptor` / middleware aborts with `504 Gateway Timeout`; otherwise it returns `200 { completedAfterMs: number, remainingBudgetMs: number | null }`.
When: `GET /conformance/priority/critical`, `/conformance/priority/high`, `/conformance/priority/normal`, or `/conformance/priority/low` is called with `?holdMs=<number>`
Then: each route is decorated with the corresponding `@ApiPriority(ApiPriorityLevel.*)` so concurrent requests holding slots trigger `InboundPriorityBulkheadGuard` load leveling and priority shedding (`503` + `Retry-After`).
Acceptance criteria: unit tests and external conformance tests verify `504` when `x-request-deadline` is shorter than `delayMs`, and `503` with `Retry-After` on low-priority shedding / bulkhead saturation.

### REQ-005 Conformance rate-limit identifier endpoints (`/conformance/rate-limit/*`)

Experience: none
Given: `ConformanceModule` is enabled
When: `GET /conformance/rate-limit/user` (JWT-authenticated, `RateLimitIdentifier.UserId`, limit 3/60s), `GET /conformance/rate-limit/fingerprint` (` Public`, `RateLimitIdentifier.DeviceFingerprint`, limit 3/60s), or `GET /conformance/rate-limit/guest` (`@Public`, `RateLimitIdentifier.GuestId`, limit 3/60s) is called
Then: the first 3 requests within the window return `200 { identifierKind: string }` with `X-RateLimit-*` headers, and the 4th request returns `429 Too Many Requests` with `Retry-After`.
Acceptance criteria: unit tests and external conformance tests verify independent rate-limit buckets per `userId`, per `x-device-fingerprint`, and per `guest_id` cookie.

### REQ-006 Conformance PII redaction endpoint (`/conformance/redaction`)

Experience: none
Given: `ConformanceModule` is enabled
When: `POST /conformance/redaction` is called with `{ payload: Record<string, unknown> }`
Then: the handler runs the payload through the boilerplate's redaction utility (`redactValue` / `redactOtelAttributes`) and logs it through Winston, returning `200 { redactedPayload: Record<string, unknown>, redactedSpanAttributes: Record<string, string | number | boolean> }`.
Acceptance criteria: unit tests and external conformance tests verify that sensitive fields (`password`, `accessToken`, `authorization`, `cookie`, `secret`, email/card patterns) are replaced with `[REDACTED]` while safe fields remain intact.

### REQ-007 Standalone language-agnostic conformance repository (`backend_boilerplate_conformance_tests`)

Experience: none
Given: a running boilerplate server at `BASE_URL` (default `http://localhost:3000`) and backing services (`MONGO_URI`, `REDIS_URL`, `POSTGRES_URL`)
When: `pnpm test` is executed in `/Users/axonitsolutions/Documents/personal/backend_boilerplate_conformance_tests`
Then: Vitest runs 14 black-box conformance suites (using only network protocols: HTTP/1.1, GraphQL-over-HTTP, Socket.IO, and wire-protocol assertions for Mongo/Redis/Postgres plus a local mock upstream server) covering:

1. `01-health-probes.conformance.spec.ts` (`/health/live`, `/health`, `/health/ready`, JSON schema, guard exemptions)
2. `02-headers-cors-compression.conformance.spec.ts` (Helmet CSP/security headers, CORS preflight, Brotli/gzip compression above threshold, `x-request-id` echo/generation)
3. `03-validation-sanitization-errors.conformance.spec.ts` (`SanitizationPipe` XSS tag stripping, `ValidationPipe` whitelist/forbidNonWhitelisted `400`, payload size limit `413`, `AllExceptionsFilter` JSON envelope)
4. `04-auth-sessions-csrf.conformance.spec.ts` (`/auth/csrf`, `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, cookie attributes, JTI revocation, double-submit CSRF enforcement & exemption, Argon2 password bulkhead)
5. `05-rate-limiting.conformance.spec.ts` (`GET /` IP limit, userId limit, device fingerprint limit, guest cookie limit, `429` + `Retry-After`)
6. `06-feature-flags-rbac.conformance.spec.ts` (`/feature-flags` CRUD, `USER` `403` vs `ADMIN` `200`, Redis state sync, Mongo `feature_flag_audits` entries)
7. `07-graphql.conformance.spec.ts` (`/graphql` categories queries, depth limit >10 rejection, query complexity budget rejection, Redis per-subject concurrency `503` + `Retry-After`)
8. `08-uploads.conformance.spec.ts` (`/uploads` valid PNG/PDF magic bytes, spoofed extension rejection, file count cap, single file size cap, total size cap)
9. `09-websockets.conformance.spec.ts` (`/realtime` Socket.IO auth handshake, room isolation `user:<id>`, DTO validation, `admin-broadcast` RBAC, connection & message rate limits)
10. `10-jobs-notifications-captcha.conformance.spec.ts` (`/example/jobs/echo` BullMQ + Postgres `background_jobs` row + `dedupeKey`, `/example/notification` Slack mock delivery & fail-open, `/example/captcha` pass/fail/unavailable via mock hCaptcha)
11. `11-cache-resilience.conformance.spec.ts` (`/conformance/cache` hit/miss, SWR, single-flight stampede, negative caching)
12. `12-http-client-resilience.conformance.spec.ts` (`/conformance/http-client` retry/backoff, circuit breaker, request coalescing, concurrency limit, `x-request-deadline` propagation)
13. `13-overload-deadline-country.conformance.spec.ts` (`/conformance/deadline/slow` `504` timeout, `/conformance/priority/*` bulkhead/shedding `503`, GeoIP country allow/block)
14. `14-redaction-and-shutdown.conformance.spec.ts` (`/conformance/redaction` PII masking, graceful shutdown readiness `503` flip)
    Acceptance criteria: all 14 suites execute deterministically and pass against `nestjs_backend_boilerplate`, and the repository includes `CONTRACT.md` documenting every endpoint, header, status code, and payload shape required for any future language boilerplate.

## Design

- **Two-repository boundary**:
  - `nestjs_backend_boilerplate` adds `src/conformance/` (controllers, DTOs, service, module) gated by `CONFORMANCE_HARNESS_ENABLED === 'true'` and blocked when `NODE_ENV === 'production'`.
  - `/Users/axonitsolutions/Documents/personal/backend_boilerplate_conformance_tests` is a standalone TypeScript/Vitest project with zero imports from `nestjs_backend_boilerplate`. It communicates solely via HTTP, GraphQL, Socket.IO, and standard database drivers (`pg`, `ioredis`, `mongodb`) for verification and fixture cleanup.

## Policy check

Skills applied: `architecture`, `api`, `security-baseline`, `testing`, `elaborate-naming`.

## Flagged concerns

None.

## Open questions carried forward

None.

## Risk tier

Tier: 1 (MEDIUM)
Class: Internal conformance test harness (`CONFORMANCE_HARNESS_ENABLED=true`, blocked in production) + external test repository.
Why: Adds non-production test harness routes and an external verification repository without changing production runtime behavior when `CONFORMANCE_HARNESS_ENABLED` is unset/false.

## Non-functional impact

- **Security**: `validateEnv` prevents `CONFORMANCE_HARNESS_ENABLED=true` when `NODE_ENV=production`. `/conformance/http-client` validates that `targetUrl` hostname is strictly `127.0.0.1` or `localhost`.
- **Performance**: Zero overhead in production because `ConformanceModule` is not imported when `CONFORMANCE_HARNESS_ENABLED !== 'true'`.

## Abuse and failure cases

- Attempt to enable `CONFORMANCE_HARNESS_ENABLED=true` with `NODE_ENV=production` → boot fails immediately in `validateEnv`.
- Attempt to pass a non-loopback URL to `POST /conformance/http-client` → rejected with `400 Bad Request`.

## Data impact

No database schema or migration changes. Conformance tests clean up their own test rows/keys in MongoDB, Postgres, and Redis.
