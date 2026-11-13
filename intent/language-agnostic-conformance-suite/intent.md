# Intent: Language-Agnostic Conformance Test Suite & Harness

Author: user · Status: Accepted · Date: 2026-11-10
Lifecycle: DRAFT

## Problem

We are building the same backend boilerplate across multiple programming languages and frameworks (starting with NestJS 12 on Fastify). Relying solely on language-specific unit tests makes it impossible to guarantee that all language ports implement identical HTTP, GraphQL, WebSocket, security, caching, resilience, and persistence behaviors. Furthermore, several internal resilience capabilities in `nestjs_backend_boilerplate` (`CacheService` stampede/SWR/negative-cache/jitter, outbound `HttpClient` retries/circuit-breaker/coalescing/adaptive-concurrency/deadline-propagation, inbound deadline timeouts, `@ApiPriority` shedding, rate-limit identifier modes, and PII log/span redaction) lack public HTTP endpoints that a black-box runner can exercise.

## User and evidence

Primary user: Boilerplate author / platform engineer implementing and maintaining multi-language backend boilerplates.
Job to be done: Run a single, language-agnostic conformance test repository against any running boilerplate instance (`BASE_URL`) to verify 100% of public and infrastructure features, while keeping only genuinely language-specific tests inside each boilerplate repository.
Current workaround: Language-coupled Jest unit/integration tests inside `nestjs_backend_boilerplate` that cannot be reused against Go, Rust, Python, or Java ports.
Evidence: user-reported

## Proposed outcome

1. **Opt-in Conformance Harness in `nestjs_backend_boilerplate` (`CONFORMANCE_HARNESS_ENABLED=true`)**:
   - Exposes `/conformance/*` endpoints only when explicitly enabled via environment variable (`CONFORMANCE_HARNESS_ENABLED=true`, default `false` and blocked in production).
   - Makes non-API internal features testable over HTTP in a language-agnostic way:
     - `POST /conformance/cache` & `DELETE /conformance/cache/:key` — exercises `CacheService.getOrSet` (SWR, single-flight stampede, Redis distributed lock, `cacheNull` negative caching, TTL jitter).
     - `POST /conformance/http-client` — exercises `HttpClient` (`internal` and `external`) against a caller-supplied mock upstream URL with configurable retry/backoff, circuit breaker, request coalescing, fixed/adaptive concurrency limit, and `x-request-deadline` propagation.
     - `GET /conformance/deadline/slow` — delays for `delayMs` while honoring the request abort signal so inbound `RequestDeadlineMiddleware` / `x-request-deadline` timeout (`504`) is black-box testable.
     - `GET /conformance/priority/:level` — routes decorated with `@ApiPriority(CRITICAL | HIGH | NORMAL | LOW)` and a hold barrier so inbound bulkhead, HTTP load-leveling wait queue, and priority shedding (`503` + `Retry-After`) are black-box testable.
     - `GET /conformance/rate-limit/user`, `GET /conformance/rate-limit/fingerprint`, `GET /conformance/rate-limit/guest` — routes exercising `RateLimitIdentifier.UserId`, `DeviceFingerprint`, and `GuestId` policies.
     - `POST /conformance/redaction` — logs and records span attributes from the request payload and returns the redacted output produced by the redaction pipeline so PII scrubbing can be verified over HTTP and via the mock OTLP collector.

2. **Standalone Conformance Test Repository (`/Users/axonitsolutions/Documents/personal/backend_boilerplate_conformance_tests`)**:
   - A standalone, zero-framework-lock-in black-box test suite (TypeScript + Vitest + native `fetch` + `socket.io-client` + `pg` + `ioredis` + `mongodb` + local mock HTTP/hCaptcha/Slack/OTLP server).
   - Organized into 14 modular feature suites covering every capability in `docs/features/features.md`:
     1. Health & Readiness Probes (`/health/live`, `/health`, `/health/ready`, guard exemptions)
     2. Security Headers, CORS, Compression & Request ID (`Helmet`, Brotli/gzip, `x-request-id`)
     3. Input Sanitization, Validation & Global Exception Envelope (`SanitizationPipe`, `ValidationPipe`, `AllExceptionsFilter`)
     4. Authentication, Sessions, Argon2 Bulkhead & Double-Submit CSRF (`/auth/*`, cookies, JTI revocation, CSRF enforcement)
     5. Rate Limiting & Guest Tracking (IP, `userId`, device fingerprint, `guest_id` cookie, `429` + `Retry-After`, Redis fallback)
     6. Feature Flags & RBAC (`/feature-flags` CRUD, `ADMIN` vs `USER` permissions, Redis evaluation & Mongo `feature_flag_audits`)
     7. GraphQL (`/graphql` queries, depth limit >10, query complexity budget, Redis per-subject concurrency `503` + `Retry-After`)
     8. File Uploads (`/uploads` magic-byte validation, extension mismatch, count/file/total size caps)
     9. WebSockets (`/realtime` Socket.IO JWT handshake, room isolation `user:<id>`, DTO validation, `admin-broadcast` RBAC, connection & message rate limits)
     10. Background Jobs, Notifications & Captcha (`/example/jobs/echo` BullMQ + Postgres `SKIP LOCKED` + `dedupeKey`, `/example/notification` Slack delivery & fail-open, `/example/captcha` pass/fail/unavailable)
     11. Cache Resilience (`/conformance/cache` SWR, stampede single-flight, negative caching, TTL jitter)
     12. Outbound HTTP Client Resilience (`/conformance/http-client` retry/backoff, circuit breaker, coalescing, concurrency limits, `x-request-deadline` propagation)
     13. Inbound Overload, Deadlines, Country Access & Priority Shedding (`/conformance/deadline/slow`, `/conformance/priority/*`, GeoIP country allow/block)
     14. PII Redaction & Graceful Shutdown (`/conformance/redaction`, OTLP span scrubbing, `SIGTERM` readiness `503` flip & drain)

3. **Clear Boundary for Language-Specific Tests in `nestjs_backend_boilerplate`**:
   - Document in `docs/quality/README.md` and `docs/features/features.md` which tests remain in `nestjs_backend_boilerplate` (TypeScript compile-time `tsd` tests, fast-check pure function property tests, unit tests of NestJS DI/decorators) versus what is verified by `backend_boilerplate_conformance_tests`.

## Why now

Before replicating the boilerplate into additional languages, we need an authoritative, executable specification that verifies the existing NestJS implementation end-to-end and serves as the acceptance gate for every future language port.

## Scope

Must:

- Opt-in `ConformanceModule` (`CONFORMANCE_HARNESS_ENABLED=true`) in `nestjs_backend_boilerplate` covering cache, outbound HTTP client, slow deadline, priority levels, rate-limit identifiers, and PII redaction.
- Standalone git repository at `/Users/axonitsolutions/Documents/personal/backend_boilerplate_conformance_tests` with local mock upstream server and 14 black-box conformance suites covering all features in `docs/features/features.md`.
- Documentation of the conformance contract so any future language boilerplate can implement the exact same endpoints and pass the suite.

Should:

- Per-suite environment/capability flags (e.g., `SKIP_DESTRUCTIVE_SHUTDOWN=true`) so developers can run fast non-destructive suites during active coding and full chaos/shutdown suites in CI.

Later:

- Docker Compose orchestrator in `backend_boilerplate_conformance_tests` that spins up multiple language boilerplates side-by-side and compares latency/throughput benchmarks.

Explicit exclusions:

- Deleting existing fast unit/property/type tests in `nestjs_backend_boilerplate` that test pure TypeScript internals or NestJS module wiring.
- Enabling `/conformance/*` routes when `CONFORMANCE_HARNESS_ENABLED` is unset/`false` or when `NODE_ENV=production`.

## Outcome

Behavioral success metric:

- Running `pnpm test` in `backend_boilerplate_conformance_tests` against `nestjs_backend_boilerplate` executes all 14 conformance suites and passes against live HTTP, GraphQL, WebSocket, Postgres, Redis, and MongoDB interfaces.
- `nestjs_backend_boilerplate` passes `pnpm quality:lint`, `pnpm quality:types`, and `pnpm test:unit` with `ConformanceModule` unit-tested.

Product risks:

- Accidental exposure of `/conformance/*` in production (mitigated by strict boot-time guard refusing to start if `NODE_ENV === 'production' && CONFORMANCE_HARNESS_ENABLED === 'true'`, plus SSRF restriction on `/conformance/http-client` to loopback `127.0.0.1` / `localhost` targets only).

Assumptions requiring validation:

- Local Docker services (MongoDB, Redis, Postgres) are reachable by both the target server and the conformance test runner for state setup/assertions (e.g., seeding an admin user or inspecting `background_jobs` / `feature_flag_audits`).

## Affected systems

- `nestjs_backend_boilerplate`: `src/conformance/*`, `src/app.module.ts`, `src/common/config/env.schema.ts`, `.env.example`, `docs/features/features.md`, `intent/README.md`.
- `/Users/axonitsolutions/Documents/personal/backend_boilerplate_conformance_tests` (new repository).

## Constraints

- Follow all `AGENTS.md` and `.cursor/rules/elaborate-naming.mdc` rules in `nestjs_backend_boilerplate` (no new dependencies in `nestjs_backend_boilerplate`, `@/` imports, named exports, boolean prefixes `is/has/can/should`, no placeholder names `data`/`result`/`item`/`temp`/`obj`/`val`, unit suffixes `Ms`/`Seconds`/`Bytes`).
- `/conformance/http-client` must only allow loopback upstream URLs (`http://127.0.0.1:*` or `http://localhost:*`) to prevent SSRF even in non-production environments.

## Open questions

None.
