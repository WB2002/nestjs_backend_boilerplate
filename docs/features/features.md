# Features

Overview of capabilities in `nestjs_backend_boilerplate`. **Implementation status** reflects what exists in code (`src/`, tests, scripts, migrations), not task-board labels.

| Status      | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| **Done**    | Implemented and wired (or available as a global module)       |
| **Partial** | Code exists but incomplete, not used app-wide, or subset only |
| **Missing** | No meaningful implementation in the repo                      |
| **N/A**     | Optional / deferred by design                                 |

## Operations (multi-VM)

- [Edge vs app rate limits](./operations/edge-vs-app-rate-limits.md)
- [ALB + multi-VM deployment](./operations/alb-multi-vm.md)
- [CloudWatch overload alerts](./operations/cloudwatch-overload-alerts.md)

---

## Feature index

| Feature                              | Route / scope                  | Status  | Detail doc                                                                                |
| ------------------------------------ | ------------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| Authentication                       | `/auth`                        | Done    | [auth.feature.md](./auth.feature.md)                                                      |
| Authorization (RBAC)                 | Feature-flag admin APIs        | Partial | [feature_flag.feature.md](./feature_flag.feature.md)                                      |
| Health checks                        | `/health`, `/health/ready`     | Done    | —                                                                                         |
| HTTP client (internal / external)    | Global provider                | Done    | [http_client.feature.md](./http_client.feature.md)                                        |
| Rate limiting                        | Global guard                   | Done    | — (`src/core/rate-limiter/`)                                                              |
| Inbound overload & priority shedding | Global guards / Fastify        | Done    | [edge vs app rate limits](./operations/edge-vs-app-rate-limits.md) — `src/core/overload/` |
| Request deadline                     | Global middleware + HttpClient | Done    | — (`src/core/request-deadline/`) — downstream `x-request-deadline` not wired              |
| Cache (SWR + resilience)             | Global module                  | Partial | `src/core/cache/` — core done; feature modules must opt in via `CacheService`             |
| Graceful shutdown                    | Process signals                | Done    | — (`src/core/shutdown/`)                                                                  |
| Response compression                 | Fastify plugin                 | Done    | —                                                                                         |
| Logging & request ID                 | Global middleware              | Done    | — (`src/core/logger/`)                                                                    |
| PII / log redaction                  | Winston + access logs + OTel   | Done    | [pii_log_redaction.feature.md](./pii_log_redaction.feature.md)                            |
| Tracing & overload metrics           | Boot + filters                 | Done    | [observability.feature.md](./observability.feature.md) — `OTEL_ENABLED`, EMF 503 reasons  |
| CSRF (cookie SPA flows)              | Global middleware              | Done    | [csrf.feature.md](./csrf.feature.md) — `GET /auth/csrf`                                   |
| GraphQL                              | `/graphql`                     | Done    | — (`src/categories/`, `app.module.ts`)                                                    |
| File uploads                         | `/uploads`                     | Done    | — (`src/uploads/`)                                                                        |
| Captcha (hCaptcha)                   | `/example/captcha`             | Partial | [captcha.feature.md](./captcha.feature.md)                                                |
| Notifications (Slack)                | `/example`                     | Done    | [notification.feature.md](./notification.feature.md)                                      |
| Feature flags                        | `/feature-flags`               | Done    | [feature_flag.feature.md](./feature_flag.feature.md)                                      |
| Country access (geo allow/block)     | Global guard                   | Done    | [country_access.feature.md](./country_access.feature.md)                                  |
| WebSockets (Socket.IO)               | `/realtime` namespace          | Done    | [websocket.feature.md](./websocket.feature.md)                                            |
| Background jobs (BullMQ)             | `/example/jobs`                | Done    | [background_jobs.feature.md](./background_jobs.feature.md)                                |
| Environment validation               | Boot                           | Done    | — (`src/common/config/`)                                                                  |
| Input sanitization                   | Global pipe                    | Done    | — (`src/common/sanitization/`)                                                            |
| Global exception handler             | APP_FILTER                     | Done    | — (`src/common/filters/`)                                                                 |
| ESLint + Husky + Gitleaks            | Git hooks                      | Done    | [../security/git_hooks.md](../security/git_hooks.md)                                      |
| CORS & CSP (Helmet)                  | `main.ts`                      | Done    | —                                                                                         |
| Cookies                              | Auth + rate-limit guest        | Done    | —                                                                                         |

---

## Implementation status (full checklist)

Last reviewed against the boilerplate roadmap (code audit, not task status). Updated 2026-10-29.

### Resilience & HTTP

| Item                            | Status      | Notes                                                                                                                                                                                                                   |
| ------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limiting                   | **Done**    | `RateLimitGuard`, memory + Redis backends, `Retry-After`. **Multi-VM:** production defaults to Redis when `RATE_LIMIT_STORAGE` unset; prefer `RateLimitIdentifier.UserId` for enterprise APIs over IP-only `global-ip`. |
| ↳ IP                            | **Done**    | Default `global-ip` policy in `app.module.ts`                                                                                                                                                                           |
| ↳ userId                        | **Done**    | Tracker + tests; guard runs after JWT                                                                                                                                                                                   |
| ↳ Device fingerprint            | **Done**    | Header-based tracker                                                                                                                                                                                                    |
| ↳ Guest ID (public API)         | **Done**    | `GuestIdMiddleware` + cookie                                                                                                                                                                                            |
| External + internal HTTP client | **Done**    | `HttpClient.internal()` / `.external()`                                                                                                                                                                                 |
| Exponential backoff with jitter | **Done**    | Strategy helpers + tests                                                                                                                                                                                                |
| Backpressure                    | **Done**    | Under-pressure + inbound bulkhead + API priority shedding + GraphQL Redis concurrency + HttpClient limits — see [edge vs app rate limits](./operations/edge-vs-app-rate-limits.md)                                      |
| Circuit breaker                 | **Done**    | Per logical client                                                                                                                                                                                                      |
| Deadline propagation            | **Done**    | Inbound ALS; outbound `HttpClient` inherits signal + caps timeouts by `remainingMs()` — optional `x-request-deadline` header to downstreams not wired                                                                   |
| Request coalescing              | **Done**    | HTTP client; cache layer single-flight                                                                                                                                                                                  |
| Load shedding + `Retry-After`   | **Done**    | **429** rate limit; **503** overload (pressure, bulkhead, priority shed, GraphQL concurrency) — see ops doc                                                                                                             |
| API priority + load shedding    | **Done**    | `@ApiPriority`, `InboundPriorityBulkheadGuard`, EMF `Reason=api_priority_shed`                                                                                                                                          |
| Queue-based load leveling       | **Partial** | **Background:** BullMQ + Postgres ledger ([background_jobs.feature.md](./background_jobs.feature.md)). **HTTP:** no request queue / delay tier                                                                          |
| Streaming responses             | **Partial** | Client `responseType: 'stream'`; no Nest SSE/stream endpoints                                                                                                                                                           |
| Graceful degradation            | **Partial** | Lazy Mongo, soft health, fail-open notifications — no unified framework                                                                                                                                                 |
| Load testing                    | **Missing** | No k6 / Artillery / ZAP configs                                                                                                                                                                                         |

### Security, auth, data

| Item                              | Status      | Notes                                                                                                             |
| --------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Google Tink / AWS Encryption SDK  | **Missing** | —                                                                                                                 |
| Encryption & hashing              | **Partial** | Argon2 passwords, RS256 JWT, SHA for keys/fingerprints                                                            |
| Authentication                    | **Done**    | Register, login, refresh, logout, sessions                                                                        |
| Authorization                     | **Partial** | JWT default-deny + `@Public()`; RBAC on feature-flag APIs only                                                    |
| Audit logs table                  | **Partial** | Mongo `feature_flag_audits` only                                                                                  |
| IP geographic allow/block         | **Done**    | MaxMind + global guard                                                                                            |
| HCaptcha / reCAPTCHA              | **Partial** | hCaptcha only                                                                                                     |
| CSRF                              | **Done**    | Double-submit cookie; see [csrf.feature.md](./csrf.feature.md)                                                    |
| CSP headers                       | **Done**    | `@fastify/helmet`                                                                                                 |
| CORS                              | **Done**    | `enableCors` in `main.ts`                                                                                         |
| Input sanitization                | **Done**    | Global `SanitizationPipe`                                                                                         |
| Max payload size                  | **Done**    | Multipart limits, upload caps, default JSON body cap                                                              |
| File upload + type validation     | **Done**    | Magic bytes, optional ClamAV                                                                                      |
| Bot detection (beyond CAPTCHA)    | **Missing** | —                                                                                                                 |
| Secrets scanning (git hooks)      | **Done**    | Gitleaks pre-commit                                                                                               |
| Dependency vulnerability scanning | **Done**    | `pnpm audit`, OSV-Scanner, Trivy, Dependency Review; Dependabot — [quality README](../quality/README.md)          |
| App-source security (Semgrep)     | **Done**    | Obfuscation/exfil heuristics on `src/`/`test/`/`scripts/` — [quality README](../quality/README.md)                |
| PII tagging / data masking        | **Done**    | App logs, HttpClient telemetry, OTLP span export — [pii_log_redaction.feature.md](./pii_log_redaction.feature.md) |
| Row-level security                | **Missing** | Deferred                                                                                                          |
| Cookies support                   | **Done**    | `@fastify/cookie`, session / access tokens                                                                        |
| Stripe                            | **Missing** | Doc example only                                                                                                  |

### Observability & ops

| Item                                            | Status      | Notes                                                                                                                                                            |
| ----------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logging                                         | **Done**    | Winston, middleware, interceptor                                                                                                                                 |
| Tracing                                         | **Done**    | OTel SDK + HTTP instrumentation (`OTEL_ENABLED`); health probes excluded; HttpClient `.addTracing()` — [observability.feature.md](./observability.feature.md)    |
| Metrics & alerts                                | **Done**    | App EMF `ServiceUnavailable` by overload reason + [CloudWatch alarm guide](../operations/cloudwatch-overload-alerts.md); HttpClient / feature-flag EMF unchanged |
| Request / correlation ID                        | **Done**    | `x-request-id` middleware                                                                                                                                        |
| Health checks                                   | **Done**    | Terminus: Mongo, memory, disk, Redis, Postgres, feature flags                                                                                                    |
| Graceful shutdown                               | **Done**    | SIGTERM/SIGINT, readiness 503, drain                                                                                                                             |
| Environment validation                          | **Done**    | `validateEnv` + `env.schema.ts`                                                                                                                                  |
| ESLint + Husky                                  | **Done**    | lint-staged on pre-commit; pre-push lint/types/unit                                                                                                              |
| Type tests (tsd)                                | **Done**    | `pnpm quality:types`                                                                                                                                             |
| Property tests (fast-check)                     | **Done**    | `pnpm quality:property`                                                                                                                                          |
| Mutation tests (Stryker)                        | **Done**    | Incremental on changed files — `pnpm quality:mutation`                                                                                                           |
| Contract tests (REST + GraphQL)                 | **Done**    | `pnpm quality:contract`                                                                                                                                          |
| Static analysis (CodeQL)                        | **Done**    | `.github/workflows/codeql.yml`                                                                                                                                   |
| Global exception handler                        | **Done**    | `AllExceptionsFilter`                                                                                                                                            |
| Response compression                            | **Done**    | Brotli + gzip                                                                                                                                                    |
| CI/CD pipeline                                  | **Done**    | GitHub Actions quality + CodeQL — [quality README](../quality/README.md)                                                                                         |
| Config hot-reload                               | **Missing** | Boot-time env only                                                                                                                                               |
| DB migrations via CLI                           | **Partial** | SQL under `migrations/postgres/`; manual `psql`                                                                                                                  |
| Database seeding                                | **Missing** | —                                                                                                                                                                |
| Background jobs (BullMQ + Postgres SKIP LOCKED) | **Done**    | [background_jobs.feature.md](./background_jobs.feature.md)                                                                                                       |

### Caching & integrations

| Item                               | Status          | Notes                                                                                                                                                     |
| ---------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache stampede protection          | **Done** (core) | `CacheService.getOrSet` — SWR, in-process single-flight, Redis loader lock when `CACHE_STORAGE=redis`; feature modules opt in by injecting `CacheService` |
| Cache penetration (negative cache) | **Partial**     | Opt-in `cacheNull: true` on `getOrSet`                                                                                                                    |
| Cache avalanche (TTL jitter)       | **Partial**     | `CACHE_TTL_JITTER_RATIO` / `ttlJitterRatio` on writes                                                                                                     |
| Feature flags                      | **Done**        | Redis + in-memory eval, Pub/Sub, reconcile                                                                                                                |
| Slack integration                  | **Done**        | Webhook provider                                                                                                                                          |
| Push notifications                 | **Missing**     | —                                                                                                                                                         |
| Send email                         | **Missing**     | —                                                                                                                                                         |
| WebSockets + Redis pub/sub         | **Done**        | [websocket.feature.md](./websocket.feature.md)                                                                                                            |
| Server-Sent Events (SSE)           | **Missing**     | —                                                                                                                                                         |
| GraphQL setup                      | **Done**        | Apollo, depth limit, complexity plugin                                                                                                                    |
| gRPC setup                         | **Missing**     | `@nestjs/microservices` used for Redis health ping only                                                                                                   |
| OWASP ZAP test                     | **Missing**     | —                                                                                                                                                         |

---

## Documented features (detail)

### Authentication

Registration, login, logout, and session management. Passwords hashed with Argon2id. Cookie-based JWT (RS256). Routes are protected by default; use `@Public()` to opt out.

See [auth.feature.md](./auth.feature.md).

### Health check

Public probes (no auth, no rate limit, no deadline, no country guard, CSRF-exempt, priority-shed exempt):

- `GET /health` — liveness-style check
- `GET /health/ready` — returns 503 while shutting down

Checks include MongoDB, heap, disk, optional Redis/Postgres, and feature-flag health (informational).

### HTTP client

Global provider under `src/core/http-client`: fluent `internal` / `external` clients, Axios transport, auth (API key, basic, bearer, OAuth client credentials, mTLS), retry with backoff/jitter, request coalescing, circuit breaker, concurrency limits, optional tracing/metrics, shutdown hooks.

See [http_client.feature.md](./http_client.feature.md).

### Rate limiting

Global `RateLimitGuard` with pluggable identifiers (IP, userId, device fingerprint, guest ID), multiple algorithms, memory or Redis storage, standard rate-limit headers and `Retry-After` on deny. `GuestIdMiddleware` issues a guest cookie for anonymous clients.

Code: `src/core/rate-limiter/`.

### Request deadline

Per-request timeout via middleware and ALS; exposes abort `signal` and `x-request-deadline`. Outbound `HttpClient` merges inbound deadline signal and remaining budget. Propagating `x-request-deadline` to downstream services is not implemented.

Code: `src/core/request-deadline/`.

### Inbound overload & API priority

`@fastify/under-pressure`, inbound in-flight bulkhead, and optional **API priority shedding** (`@ApiPriority`, `InboundPriorityBulkheadGuard`) when `INBOUND_PRIORITY_SHEDDING_ENABLED=true`. Shedding returns **503** + `Retry-After`; EMF reason `api_priority_shed`. See [edge vs app rate limits](./operations/edge-vs-app-rate-limits.md).

Code: `src/core/overload/`.

### CSRF

Double-submit cookie for cookie-based auth (`CSRF_ENABLED`, default on). `GET /auth/csrf` and login/refresh rotate `csrf_token`; mutating requests with session cookies require matching `x-csrf-token`. Health probes exempt.

See [csrf.feature.md](./csrf.feature.md).

### Observability

Optional app tracing via `instrumentation.ts` (`OTEL_ENABLED`). Overload paths emit CloudWatch EMF for 503s (including priority shed). HttpClient and feature flags retain opt-in telemetry.

See [observability.feature.md](./observability.feature.md) and [CloudWatch overload alerts](../operations/cloudwatch-overload-alerts.md).

### Background jobs

Postgres ledger + BullMQ + `FOR UPDATE SKIP LOCKED` claims. See [background_jobs.feature.md](./background_jobs.feature.md).

### Cache

Stale-while-revalidate, in-process single-flight, and Redis SET-NX loader locks (multi-VM) on `getOrSet`. Optional TTL jitter (`CACHE_TTL_JITTER_RATIO`) spreads expirations. Opt-in negative caching (`cacheNull: true`) stores short-lived absent entries for missing keys.

Example:

```typescript
await cacheService.getOrSet(`user:${id}`, () => repo.findById(id), {
  ttl: { softTtlMs: 60_000, hardTtlMs: 300_000 },
  cacheNull: true,
  negativeTtl: { softTtlMs: 30_000, hardTtlMs: 60_000 },
});
```

Production defaults to Redis storage when `CACHE_STORAGE` is unset; development uses memory. Feature code must inject `CacheService` to use caching.

Code: `src/core/cache/`.

### Captcha

`CaptchaService` with hCaptcha implementation and demo `POST /example/captcha`. Not wired into auth flows. No reCAPTCHA provider.

See [captcha.feature.md](./captcha.feature.md).

### Notifications

`INotificationService` with Slack Incoming Webhooks. Demo: `POST /example/notification`. Failures do not fail the caller’s business operation.

See [notification.feature.md](./notification.feature.md).

### Feature flags

Redis-backed flags, in-memory evaluation on the request path, Pub/Sub + reconciliation. Admin CRUD with permission guards; audit rows in `feature_flag_audits`.

See [feature_flag.feature.md](./feature_flag.feature.md).

### Country access

Geo allow/block using MaxMind GeoLite2, in-memory snapshot, global guard. Default Postgres repository; Mongo swap documented.

See [country_access.feature.md](./country_access.feature.md).

### GraphQL

Apollo on Fastify, schema via `*.graphql`, sample `CategoriesModule`, depth limit, query complexity + **Redis-backed** per-subject concurrency in `ComplexityPlugin` (`GQL_MAX_CONCURRENCY`, TTL leak safety via `GQL_CONCURRENCY_KEY_TTL_SEC`, keys by JWT user or `guest_id` cookie). Concurrency denial returns **503** + `Retry-After` (overload). Limits are **cluster-wide** when Redis is shared across tasks.

### File uploads

Multipart uploads with count/size/total limits, extension + magic-byte validation, optional ClamAV scan.

Code: `src/uploads/`.

### Cross-cutting (no separate feature doc)

- **Logging:** Winston + request ID (`src/core/logger/`).
- **Log redaction:** Shared module `src/core/redaction/` — [pii_log_redaction.feature.md](./pii_log_redaction.feature.md).
- **Tracing:** OpenTelemetry Node SDK when enabled (`src/instrumentation.ts`, `src/core/telemetry/`).
- **Sanitization:** Global pipe before validation (`src/common/sanitization/`).
- **Compression / security headers / CORS:** Registered in `src/main.ts`.
- **Shutdown:** `registerGracefulShutdown` + `ShutdownState` (`src/core/shutdown/`).
- **Env validation:** `src/common/config/validate-env.ts`.
- **Overload admission:** Under-pressure + bulkhead middleware order in `app.module.ts`.

---

## Adding a new feature

1. Add a row to **Feature index** (and update **Implementation status** if it maps to a roadmap item).
2. Create `docs/features/<resource>.feature.md` when the feature needs more than a short summary.
3. Link the doc from the index table and from a **Documented features** subsection if applicable.
