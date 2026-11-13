# Language-Agnostic Conformance Suite & Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Source: intent/language-agnostic-conformance-suite/spec.md
Experience: none
Lifecycle: DRAFT

**Goal:** Prove every feature in `docs/features/features.md` works, using one black-box suite in its own repo that any language port of the boilerplate can run against.

**Architecture:** Part A adds an opt-in `ConformanceModule` (`/conformance/*`) to `nestjs_backend_boilerplate`. It makes internal-only features (cache, outbound HTTP client, deadline, priority, non-IP rate-limit identifiers, redaction) reachable over HTTP. Part B creates `backend_boilerplate_conformance_tests`, a standalone Vitest project. It talks to the target only through HTTP, GraphQL, Socket.IO and the database wire protocols, and runs a local mock upstream for hCaptcha, Slack, OTLP and downstream HTTP. Each suite asserts the behavior the docs describe. A failing assertion is a finding to triage. It is never a reason to loosen the test.

**Tech Stack:** Part A: NestJS 12, Fastify 5, Jest (no new dependencies). Part B: Node 24.9+, pnpm, TypeScript, Vitest, `socket.io-client`, `pg`, `ioredis`, `mongodb`, `ajv`, `ajv-formats`, `node:http` for mocks.

**Spec:** [spec.md](spec.md) · [intent.md](intent.md)

## Global Constraints

- Part A follows `AGENTS.md`. **No new dependencies** in the boilerplate. `@/` imports, named exports, `dto/` barrels. Every DTO property has class-validator decorators. Switches end with a `never` default. No empty `catch`.
- Naming follows `.cursor/rules/elaborate-naming.mdc`: `is/has/can/should` booleans, no `data/result/item/temp/obj/val`, and unit suffixes (`Ms`, `Bytes`, `Sec`).
- Boilerplate tests go in `src/**/tests/*.spec.ts` and must run without Docker. Per-task gate: `pnpm quality:lint && pnpm quality:types && pnpm test:unit`.
- New env keys go in `src/common/config/env.schema.ts` (`required: false`) and in `.env.example`.
- `/conformance/*` exists only when `CONFORMANCE_HARNESS_ENABLED === 'true'`. Boot fails if that is set with `NODE_ENV === 'production'`.
- `/conformance/http-client` accepts only `http:` URLs whose hostname is exactly `127.0.0.1` or `localhost`. Anything else gets 400.
- Conformance repo: **zero imports from any boilerplate**. Every assertion goes over the network.
- Conformance tests run sequentially (`fileParallelism: false`). Each test file uses its own client IP via `X-Forwarded-For` from `198.51.100.0/24` (target runs with `TRUST_PROXY=true`), so the global `10 req/60s` IP limit cannot couple files.
- **Never weaken, skip, or delete an assertion to get green.** A failure against the boilerplate goes into `FINDINGS.md` (test, expected, actual, suspected cause) and is fixed in the boilerplate through `/fix-bug`.
- Overload is **503 + `Retry-After`**. Quota is **429 + `Retry-After`**. The error envelope is `{ statusCode, timestamp, path, requestId, message }`.

## Review Focus

1. **Harness leaks into production builds (Task 1).** With the env unset, `/conformance/cache` must be 404, not 401 or 403. With `NODE_ENV=production` plus the flag, boot must fail. Both are tested in Task 1.
2. **SSRF bypass on `/conformance/http-client` (Task 3).** `http://127.0.0.1.evil.test`, `http://[::1]`, `https://localhost`, `http://user@169.254.169.254`, and `file:///etc/passwd` all get 400. Tested in Task 3.
3. **Cross-file rate-limit bleed (Task 8).** A suite that reuses an IP after `05-rate-limiting` would see spurious 429s. The `clientIpFor(suiteName)` helper is pinned by a test in Task 8.
4. **Deadline abort leaves work running (Task 4).** When `/conformance/deadline/slow` times out, the timer must be cleared and the handler must not write after 504. Tested in Task 4 (no unhandled-rejection or "reply already sent" log in the unit test).
5. **Shutdown suite kills the target mid-run (Task 15).** It runs only when `RUN_DESTRUCTIVE=true`, and it is ordered last. Tested by the suite's own skip guard and by the `vitest.config.ts` sequence.

## Human gates (stop points)

- `intent.md` is accepted. **`spec.md` is still Lifecycle DRAFT, so a human accepts it before Task 1 starts.**
- Tier 1 (MEDIUM), so no architecture gate is needed.
- **Task 8 adds dependencies to a brand-new repo.** The list is in Task 8. The human approves it before `pnpm add` runs.
- **Task 17 (retire duplicated boilerplate tests) needs per-file human approval.** It runs only after the matching conformance suite is green.

## Files that change

| Task | Repo        | Create                                                                                                                                                                                                                                                                                | Modify                                                                                                                                                      |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | boilerplate | `src/common/config/is-conformance-harness-enabled.ts`, `src/common/config/tests/is-conformance-harness-enabled.spec.ts`, `src/conformance/conformance.module.ts`, `src/conformance/index.ts`, `src/conformance/tests/conformance-module-gate.spec.ts`                                 | `src/common/config/validate-env.ts`, `src/common/config/tests/validate-env.spec.ts`, `src/common/config/env.schema.ts`, `src/app.module.ts`, `.env.example` |
| 2    | boilerplate | `src/conformance/cache/conformance-cache.controller.ts`, `conformance-cache.service.ts`, `src/conformance/dto/conformance-cache-request.dto.ts`, `src/conformance/dto/index.ts`, `src/conformance/tests/conformance-cache.service.spec.ts`                                            | `conformance.module.ts`                                                                                                                                     |
| 3    | boilerplate | `src/conformance/http-client/assert-loopback-target-url.ts`, `conformance-http-client.controller.ts`, `conformance-http-client.service.ts`, `dto/conformance-http-client-request.dto.ts`, `tests/assert-loopback-target-url.spec.ts`, `tests/conformance-http-client.service.spec.ts` | `conformance.module.ts`, `dto/index.ts`                                                                                                                     |
| 4    | boilerplate | `src/conformance/overload/conformance-deadline.controller.ts`, `conformance-priority.controller.ts`, `wait-for-delay-or-abort.ts`, `tests/wait-for-delay-or-abort.spec.ts`, `tests/conformance-priority.controller.spec.ts`                                                           | `conformance.module.ts`                                                                                                                                     |
| 5    | boilerplate | `src/conformance/rate-limit/conformance-rate-limit.controller.ts`, `tests/conformance-rate-limit.controller.spec.ts`                                                                                                                                                                  | `conformance.module.ts`                                                                                                                                     |
| 6    | boilerplate | `src/conformance/redaction/conformance-redaction.controller.ts`, `dto/conformance-redaction-request.dto.ts`, `tests/conformance-redaction.controller.spec.ts`                                                                                                                         | `conformance.module.ts`, `dto/index.ts`                                                                                                                     |
| 7    | boilerplate | `.env.conformance.example`, `docs/features/conformance_harness.feature.md`                                                                                                                                                                                                            | `docs/features/features.md`, `docs/quality/README.md`, `intent/README.md`                                                                                   |
| 8    | conformance | repo scaffold (see task)                                                                                                                                                                                                                                                              | —                                                                                                                                                           |
| 9–15 | conformance | `tests/NN-*.conformance.spec.ts`, plus `CONTRACT.md` sections                                                                                                                                                                                                                         | `FINDINGS.md`                                                                                                                                               |
| 16   | conformance | `.github/workflows/conformance.yml`, `scripts/run-against-nestjs.sh`                                                                                                                                                                                                                  | `README.md`                                                                                                                                                 |
| 17   | boilerplate | —                                                                                                                                                                                                                                                                                     | delete approved duplicate specs only                                                                                                                        |

## Order of work

1 → 2 → 3 → 4 → 5 → 6 → 7 (Part A, each one commit), then 8 → 9 … 15 → 16, then 17. Tasks 9–15 depend only on Task 8 and on Part A being deployed locally.

---

## Part A — Boilerplate harness (`nestjs_backend_boilerplate`)

### Task 1: Harness gate (REQ-001)

**Interfaces:**

- Produces: `isConformanceHarnessEnabled(env: NodeJS.ProcessEnv = process.env): boolean` in `src/common/config/is-conformance-harness-enabled.ts`. Returns `env.CONFORMANCE_HARNESS_ENABLED === 'true'`.
- Produces: `@Module({}) export class ConformanceModule {}`, exported from `src/conformance/index.ts`. Later tasks add controllers and providers.
- Changes: `validateEnv(config)` throws `Error('CONFORMANCE_HARNESS_ENABLED cannot be true when NODE_ENV=production')` when both hold. It still collects missing required keys first, then checks this.

- [ ] **Step 1: Write failing tests**
  - `is-conformance-harness-enabled.spec.ts`: `{}` → `false`. `{ CONFORMANCE_HARNESS_ENABLED: 'false' }` → `false`. `'TRUE'` → `false` (exact match only). `'true'` → `true`.
  - `validate-env.spec.ts`, added cases: `throws when harness enabled in production` (all required keys present, `NODE_ENV: 'production'`, `CONFORMANCE_HARNESS_ENABLED: 'true'` → `toThrow(/CONFORMANCE_HARNESS_ENABLED cannot be true/)`). `allows harness outside production` (`NODE_ENV: 'test'` → returns config).
  - `conformance-module-gate.spec.ts`: build a Fastify Nest app from a tiny test module that imports `ConformanceModule` only when `isConformanceHarnessEnabled(env)` is true (the same expression as `app.module.ts`). With the flag unset, `inject GET /conformance/cache-probe` → `404`. Add a trivial `@Get('conformance/cache-probe')` test-only controller inside the spec file, not in `src/`.
- [ ] **Step 2:** `pnpm exec jest --config jest.config.ts src/common/config/tests src/conformance/tests` → FAIL (module missing).
- [ ] **Step 3: Implement.** Add the helper and the `validateEnv` check. Add `CONFORMANCE_HARNESS_ENABLED: { required: false }` to `env.schema.ts` under a `// Conformance harness (test only; refused in production)` heading. In `app.module.ts` `imports`, add `...(isConformanceHarnessEnabled() ? [ConformanceModule] : [])` next to the WebSocket and background-jobs conditionals. Add `CONFORMANCE_HARNESS_ENABLED=false` to `.env.example` with a one-line comment.
- [ ] **Step 4:** run the same specs → PASS. Then run the per-task gate.
- [ ] **Step 5: Commit** `feat(conformance): opt-in harness module gated by env, refused in production`

### Task 2: `/conformance/cache` (REQ-002)

**Interfaces:**

- Consumes: `CacheService.getOrSet`, `CacheService.delete` from `@/core/cache`.
- Produces: `ConformanceCacheRequestDto { key: string; value?: string | null; loaderDelayMs?: number; shouldFailLoader?: boolean; softTtlMs: number; hardTtlMs: number; shouldCacheNull?: boolean; negativeSoftTtlMs?: number; negativeHardTtlMs?: number }`. Validators: `@IsString() @MinLength(1) @MaxLength(200)` on `key`; `@IsOptional() @IsString()` with `@ValidateIf(v !== null)` on `value`; `@IsInt() @Min(0) @Max(10_000)` on delays; `@IsInt() @Min(1) @Max(600_000)` on TTLs; `@IsOptional() @IsBoolean()` on flags.
- Produces: `ConformanceCacheService.getOrSet(request: ConformanceCacheRequestDto): Promise<{ cachedValue: string | null; loaderCallCount: number; isFromLoader: boolean }>` and `ConformanceCacheService.reset(key: string): Promise<void>`. Every cache key is namespaced `conformance:<key>`.
- Routes: `@Public() @Controller('conformance/cache')`. `POST /` → 200 (`@HttpCode(200)`). `DELETE /:key` → `{ deleted: true }`.

- [ ] **Step 1: Write failing tests** in `conformance-cache.service.spec.ts`, using the real `CacheService` with the in-memory backend (`CacheModule.forRoot({ storage: 'memory' })` or whatever `src/core/cache/tests/cache.service.spec.ts` already uses):
  - `first call runs loader` → `{ cachedValue: 'v1', loaderCallCount: 1, isFromLoader: true }`.
  - `second call within soft TTL hits cache` → `loaderCallCount: 1`, `isFromLoader: false`.
  - `parallel calls single-flight` → 5 concurrent calls with `loaderDelayMs: 50` give `loaderCallCount: 1` on every response.
  - `shouldCacheNull caches absence` → `value: null`, `shouldCacheNull: true`, negative TTLs 1000/2000; call twice → `cachedValue: null`, `loaderCallCount: 1`.
  - `loader failure propagates` → `shouldFailLoader: true` rejects. The controller maps it to `502` with message `Conformance loader failed`.
  - `reset clears counter and entry` → after `reset('k')`, the next call has `loaderCallCount: 1`, `isFromLoader: true`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Keep the per-key counter in a `Map<string, number>`. Compute `isFromLoader` by comparing the counter before and after `getOrSet`. Throw `BadGatewayException('Conformance loader failed')` when the loader rejects.
- [ ] **Step 4:** run → PASS. Then run the gate.
- [ ] **Step 5: Commit** `feat(conformance): expose CacheService getOrSet for black-box tests`

### Task 3: `/conformance/http-client` (REQ-003)

**Interfaces:**

- Produces: `assertLoopbackTargetUrl(rawUrl: string): URL`. Throws `BadRequestException('targetUrl must be http://127.0.0.1 or http://localhost')` unless `new URL(rawUrl)` parses, `protocol === 'http:'`, `hostname` is `'127.0.0.1'` or `'localhost'`, and `username`/`password` are empty.
- Produces: `ConformanceHttpClientRequestDto { clientKind: 'internal' | 'external'; clientName: string; targetUrl: string; maxRetries?: number; baseDelayMs?: number; circuitBreakerFailureThreshold?: number; circuitBreakerResetTimeoutMs?: number; shouldCoalesce?: boolean; concurrencyMode?: 'fixed' | 'adaptive'; maxConcurrent?: number; shouldPropagateDeadline?: boolean; timeoutMs?: number }`. Validators: `@IsIn` for the enums, `@Matches(/^[a-z0-9-]{1,64}$/)` on `clientName`, `@IsInt` with bounds (`maxRetries` 0–5, `baseDelayMs` 0–2000, threshold 1–20, reset 100–60000, `maxConcurrent` 1–100, `timeoutMs` 50–30000).
- Produces: `ConformanceHttpClientService.execute(request): Promise<{ upstreamStatus: number; upstreamBody: unknown }>`. It caches one `ConfiguredHttpClient` per `clientName` (`Map<string, ConfiguredHttpClient>`, max 50 entries, evicting the oldest), built from `HttpClient.internal|external(clientName)` plus:
  - `maxRetries` → `.addRetry({ maxAttempts: maxRetries + 1, backoff: exponentialBackoff({ baseDelay: baseDelayMs ?? 50 }), jitter: fullJitter() })`
  - threshold → `.addCircuitBreaker({ failureThreshold, resetTimeout: circuitBreakerResetTimeoutMs ?? 1000 })`
  - `shouldCoalesce` → `.addRequestCoalescing()`
  - `maxConcurrent` → `.addConcurrencyLimit({ mode: concurrencyMode ?? 'fixed', maxConcurrent })`
  - `shouldPropagateDeadline` → `.addDeadlinePropagation({ propagateHeader: true })`
  - `timeoutMs` → `.addTimeout({ timeoutMs })`
- Error mapping (switch on `error.name` with a `never`-style default that rethrows): `CircuitOpenError` → 503. `TimeoutError` → 504. `RetryExhaustedError`, `HttpError`, `NetworkError` → 502. Body: `{ errorName, errorMessage, statusCode? }` (`statusCode` comes from `HttpError.status`).
- Route: `@Public() @Controller('conformance/http-client')`, `POST /` → 200.

- [ ] **Step 1: Write failing tests**
  - `assert-loopback-target-url.spec.ts`: accepts `http://127.0.0.1:4010/x` and `http://localhost:4010/x`. Rejects (400) `https://localhost/x`, `http://127.0.0.1.evil.test/x`, `http://[::1]:4010/x`, `http://user@127.0.0.1/x`, `http://169.254.169.254/`, `file:///etc/passwd`, and `not a url`.
  - `conformance-http-client.service.spec.ts`: start a `node:http` server on port 0 in `beforeAll`. Then:
    - `returns upstream body` → `{ upstreamStatus: 200, upstreamBody: { ok: true } }`.
    - `retries 503 then succeeds` → server returns 503, 503, 200 with `maxRetries: 2, baseDelayMs: 1` → 200, and the server saw 3 requests.
    - `maps open circuit to 503` → threshold 2, server always 500; after 2 calls the 3rd throws `ServiceUnavailableException` and the server saw only 2 requests.
    - `reuses client per clientName` → two calls with the same name share breaker state (covered by the circuit test).
    - Set `process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS = 'true'` in `beforeAll` and restore it in `afterAll`, the same pattern as `request-builder.ssrf.spec.ts`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** per the interfaces. The controller calls `assertLoopbackTargetUrl` before the service.
- [ ] **Step 4:** run → PASS. Then run the gate.
- [ ] **Step 5: Commit** `feat(conformance): loopback-only HttpClient probe for resilience tests`

### Task 4: `/conformance/deadline/slow` and `/conformance/priority/:level` (REQ-004)

**Interfaces:**

- Produces: `waitForDelayOrAbort(delayMs: number, signal: AbortSignal | undefined): Promise<void>`. Resolves after `delayMs`. If `signal` aborts first, it rejects with `signal.reason` and clears the timer. If `signal` is already aborted, it rejects immediately.
- Route `@Public() @Controller('conformance/deadline')`, `GET slow?delayMs=` (`@Query` DTO, `@IsInt() @Min(0) @Max(30_000)`). It runs `waitForDelayOrAbort(delayMs, getRequestSignal())`, then `throwIfAborted()`, then returns `{ completedAfterMs, remainingBudgetMs: remainingMs() ?? null }`. Deadline errors bubble to the existing 504 mapping.
- Route `@Public() @Controller('conformance/priority')` with four methods, `GET critical|high|normal|low?holdMs=` (0–10000). Each has `@ApiPriority(ApiPriorityLevel.Critical|High|Normal|Low)`, waits `holdMs` via `waitForDelayOrAbort`, and returns `{ priority: 'critical' | 'high' | 'normal' | 'low' }`. Four static routes, not `:level`, because the decorator is static metadata.

- [ ] **Step 1: Write failing tests**
  - `wait-for-delay-or-abort.spec.ts` (fake timers): resolves after delay. Rejects with the abort reason when aborted mid-wait, and `jest.getTimerCount()` is 0 afterward. Rejects immediately for a pre-aborted signal.
  - `conformance-priority.controller.spec.ts`: `Reflector` reads the `ApiPriority` metadata on each handler as `Critical/High/Normal/Low`. `GET low?holdMs=0` returns `{ priority: 'low' }`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS, then run the gate.
- [ ] **Step 5: Commit** `feat(conformance): slow and priority-tagged routes for deadline and shedding tests`

### Task 5: `/conformance/rate-limit/*` (REQ-005)

**Interfaces:** `@Controller('conformance/rate-limit')` with three `GET` routes. Each has `@RateLimit({ algorithm: RateLimitAlgorithm.FixedWindowCounter, methods: [{ name, identifier, duration: 60_000, limit: 3 }] })` and returns `{ identifierKind }`:

- `user`: JWT-protected (no `@Public`), `name: 'conformance-user'`, `RateLimitIdentifier.UserId` → `{ identifierKind: 'user' }`
- `fingerprint`: `@Public`, `name: 'conformance-fingerprint'`, `DeviceFingerprint` (header `x-device-fingerprint`) → `'fingerprint'`
- `guest`: `@Public`, `name: 'conformance-guest'`, `GuestId` (cookie `guest_id`) → `'guest'`

- [ ] **Step 1: Write failing test** `conformance-rate-limit.controller.spec.ts`: `Reflector` reads `RATE_LIMIT_KEY` metadata per handler and expects the identifier, `limit: 3`, and `duration: 60_000`. `user` has no `@Public` metadata. (The end-to-end 429 behavior is proven in conformance suite 05.)
- [ ] **Step 2–4:** FAIL → implement → PASS, then run the gate.
- [ ] **Step 5: Commit** `feat(conformance): rate-limit routes for userId, fingerprint and guest identifiers`

### Task 6: `/conformance/redaction` (REQ-006)

**Interfaces:**

- `ConformanceRedactionRequestDto { payload: Record<string, unknown> }` with `@IsObject()`. Note: the global `SanitizationPipe` runs first, so string values arrive sanitized, and that is fine.
- `@Public() @Controller('conformance/redaction')`, `POST /` → 200. Returns `{ redactedPayload: redactForLog(payload), redactedSpanAttributes: redactOtelAttributes(flattenToDottedKeys(payload)) }`. It also logs `logger.log({ conformancePayload: payload })` through Nest `Logger` so the Winston redaction path runs. `flattenToDottedKeys` is a private function in the controller file: max depth 4, dotted keys, primitives only.

- [ ] **Step 1: Write failing test** `conformance-redaction.controller.spec.ts`: payload `{ email: 'a@b.co', password: 'hunter2', profile: { name: 'Ann', accessToken: 'tok' }, note: 'card 4111 1111 1111 1111' }`. Expect `redactedPayload.password === REDACTED` and `redactedPayload.profile.accessToken === REDACTED`. `profile.name === 'Ann'` and `redactedSpanAttributes['profile.accessToken'] === REDACTED`. For `email` and `note`, assert whatever `redactForLog` actually does today. **Read `redact-value-patterns.ts` first and encode its current behavior.** If it does not mask card numbers, write the expected-masked assertion anyway and record the gap in `FINDINGS.md` in Task 15. Do not loosen it here.
- [ ] **Step 2–4:** FAIL → implement → PASS, then run the gate.
- [ ] **Step 5: Commit** `feat(conformance): redaction probe returning log and span redaction output`

### Task 7: Conformance env profile and docs

- [ ] **Step 1: Create `.env.conformance.example`.** Values only, no secrets; required secrets reference `.env.example`. These values are pinned because the conformance suites assert against them:
  ```
  NODE_ENV=test
  CONFORMANCE_HARNESS_ENABLED=true
  TRUST_PROXY=true
  HTTP_CLIENT_ALLOW_PRIVATE_URLS=true
  RATE_LIMIT_STORAGE=Redis
  CACHE_STORAGE=redis
  COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY=allow
  COUNTRY_ACCESS_REFRESH_INTERVAL_MS=1000
  FEATURE_FLAG_ADMIN_EMAILS=conformance-admin@example.test
  HCAPTCHA_SECRET=conformance-secret
  HCAPTCHA_VERIFY_BASE_URL=http://127.0.0.1:4010/hcaptcha
  SLACK_WEBHOOK_URL=http://127.0.0.1:4010/slack
  OTEL_ENABLED=true
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4010/otlp
  LOG_REDACTION_ENABLED=true
  WEBSOCKET_ENABLED=true
  WEBSOCKET_MAX_CONNECTIONS_PER_USER=3
  WEBSOCKET_MESSAGES_PER_MINUTE=10
  BACKGROUND_JOBS_ENABLED=true
  BACKGROUND_WORKER_ENABLED=true
  INBOUND_BULKHEAD_ENABLED=true
  INBOUND_MAX_IN_FLIGHT=8
  INBOUND_PRIORITY_SHEDDING_ENABLED=true
  INBOUND_LOAD_LEVELING_ENABLED=true
  INBOUND_LOAD_LEVEL_MAX_QUEUE=4
  INBOUND_LOAD_LEVEL_MAX_WAIT_MS=500
  REQUEST_TIMEOUT_MS=5000
  REQUEST_TIMEOUT_MAX_MS=10000
  GQL_MAX_CONCURRENCY=2
  GQL_USER_BUDGET=1000
  UPLOAD_MAX_FILES=3
  UPLOAD_MAX_FILE_SIZE=100000
  UPLOAD_MAX_TOTAL_SIZE=200000
  COMPRESSION_THRESHOLD=1024
  ```
  Before committing, confirm each key exists in `env.schema.ts` and check the accepted value format in its parser (for example the `INBOUND_PRIORITY_SHED_*_AT` defaults). If a parser rejects a value, fix the value here and record it under "Departures from plan".
- [ ] **Step 2: Docs.** Write `docs/features/conformance_harness.feature.md`: routes, env gate, SSRF rule, and a link to the conformance repo's `CONTRACT.md`. Add a row to the `features.md` Feature index (`Conformance harness | /conformance/* (test only) | Done`). In `docs/quality/README.md`, add a "Language-specific vs conformance" section. It lists what stays in this repo (tsd type tests, fast-check property tests, unit tests of pure functions and Nest DI/decorator wiring, Testcontainers persistence tests) and says HTTP-observable behavior belongs in the conformance repo. Add the `intent/README.md` index row (`language-agnostic-conformance-suite | yes | yes |`).
- [ ] **Step 3:** `pnpm quality:lint && pnpm quality:types && pnpm test:unit`, then `scripts/verify.sh`.
- [ ] **Step 4: Commit** `docs(conformance): env profile and language-specific vs conformance boundary`

---

## Part B — Conformance repo (`/Users/axonitsolutions/Documents/personal/backend_boilerplate_conformance_tests`)

**How tasks 9–15 run:** start the target with `.env.conformance.example` merged over `.env`, plus Mongo, Redis and Postgres (migrations 001 and 002 applied). Then run `pnpm test -- tests/NN-*.spec.ts`. The cycle per test is: write → run → **PASS** (behavior confirmed) or **FAIL**. On FAIL, decide whether the test or the boilerplate is wrong, using the feature doc as the arbiter. A test bug gets fixed in the test. A boilerplate bug goes into a `FINDINGS.md` entry, and the test stays red and is marked `it.fails` **only** with a `FINDINGS.md#F-NNN` reference in its title. Each task ends with a commit in the conformance repo.

### Task 8: Repo scaffold, shared helpers, mock upstream

**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `README.md`, `CONTRACT.md` (section headings 01–14), `FINDINGS.md`, `src/config.ts`, `src/http/conformance-client.ts`, `src/http/cookie-jar.ts`, `src/http/client-ip.ts`, `src/fixtures/users.ts`, `src/fixtures/databases.ts`, `src/mock-upstream/mock-upstream.ts`, `src/global-setup.ts`, `tests/00-harness-self-test.spec.ts`.

**Dependencies (human approves first):** dev: `typescript`, `vitest`, `@types/node`. runtime-in-tests: `socket.io-client@^4`, `pg@^8`, `@types/pg`, `ioredis@^5`, `mongodb@^6`, `ajv@^8`, `ajv-formats@^3`. Nothing else; use native `fetch` and `node:http`.

**Interfaces:**

- `loadConformanceConfig(): ConformanceConfig`, where `ConformanceConfig = { baseUrl; socketPath: string /* default '/socket.io' */; mongoUri; redisUrl; postgresUrl; mockUpstreamPort: number /* 4010 */; adminEmail /* conformance-admin@example.test */; isDestructiveEnabled: boolean /* RUN_DESTRUCTIVE==='true' */; shutdownCommand?: string }`.
- `clientIpFor(suiteName: string, index = 0): string`. Deterministic `198.51.100.<1 + (hash(suiteName) + index) % 250>`.
- `class CookieJar { applyTo(headers: Headers): void; storeFrom(response: Response): void; get(name: string): string | undefined; clear(): void }`
- `createConformanceClient(options: { suiteName: string; jar?: CookieJar; ipIndex?: number }): { request(path: string, init?: RequestInit & { json?: unknown; bearerToken?: string; csrf?: boolean }): Promise<Response> }`. It sets `X-Forwarded-For`, applies and stores cookies, and serializes `json`. With `csrf: true` it copies the `csrf_token` cookie into `x-csrf-token`.
- `registerAndLogin(client, options?: { email?: string; password?: string }): Promise<{ email; password; accessToken; sessionId; csrfToken }>`. Default email `u-<uuid>@example.test`, password `Conformance!Pass123`.
- `loginAsAdmin(client)`: registers `config.adminEmail` if needed (409 is fine) and logs in.
- `withDatabases<T>(fn: (dbs: { pg: Pool; redis: Redis; mongo: Db }) => Promise<T>): Promise<T>`
- `startMockUpstream(port: number): Promise<MockUpstream>`, where `MockUpstream = { script(path: string, responses: ScriptedResponse[]): void; recorded(path: string): RecordedRequest[]; reset(): void; close(): Promise<void> }`, `ScriptedResponse = { status: number; body?: unknown; delayMs?: number; headers?: Record<string, string> }`, `RecordedRequest = { method; path; headers: Record<string, string>; body: string; receivedAt: number }`. Unscripted paths get `200 {}`. A script is consumed in order and its last entry repeats. It records every request, including `/hcaptcha/*`, `/slack`, and `/otlp/*`.
- `global-setup.ts` starts the mock upstream once (port from config), exposes it through `globalThis.__mockUpstream`, and polls `GET /health/live` until 200 (30 s timeout).
- `vitest.config.ts`: `fileParallelism: false`, `sequence: { concurrent: false }`, `testTimeout: 30_000`, `globalSetup: 'src/global-setup.ts'`, `include: ['tests/**/*.spec.ts']`. Filename order keeps `15-*` last.

- [ ] **Step 1:** `git init`, scaffold files, `pnpm add` (after approval).
- [ ] **Step 2: Write `00-harness-self-test.spec.ts`:** `clientIpFor('a') === clientIpFor('a')`, and `clientIpFor('a') !== clientIpFor('b')` for the 15 real suite names (no collisions). CookieJar round-trips `Set-Cookie: a=1; Path=/; HttpOnly`. The mock upstream script `[503, 200]` serves 503 then 200 then 200 and records 3 requests.
- [ ] **Step 3:** `pnpm test -- tests/00-harness-self-test.spec.ts` → PASS (no target needed except global setup's health poll; allow `SKIP_TARGET_WAIT=true` for this file).
- [ ] **Step 4: Commit** `chore: scaffold conformance runner, helpers and mock upstream`

### Task 9: Suites 01–03 — probes, headers, validation (REQ-007 §1–3)

**`01-health-probes.conformance.spec.ts`**

- `GET /health/live` → 200 `{ status: 'ok' }`.
- `GET /health` and `/health/ready` → 200, and the body validates against `schemas/health-ready.schema.json` (copy the schema from the boilerplate's `test/contracts/rest/schemas/`; it is language-neutral JSON). `details` contains `mongo`, `redis`, `postgres`, `feature_flags`.
- **Probes are exempt:** 15 sequential `GET /health/ready` from one IP → all 200 (no 429). A `POST /health` with a session cookie and no CSRF header gives a status other than 403-CSRF (expect 404).

**`02-headers-cors-compression.conformance.spec.ts`**

- `GET /health/live` has `x-content-type-options: nosniff`, `x-frame-options` present, a `content-security-policy` that contains `default-src 'self'`, and no `x-powered-by`.
- `x-request-id: conf-abc-123` on a request whose response is an error (`GET /does-not-exist`) → body `requestId === 'conf-abc-123'`. Without the header → `requestId` matches a UUID.
- CORS preflight `OPTIONS /auth/login` with `Origin: http://localhost:3000` and `Access-Control-Request-Method: POST` → `access-control-allow-origin: http://localhost:3000`, `access-control-allow-credentials: true`.
- Compression: a `POST /graphql` `{ categories { id name description } }` response over 1024 bytes with `Accept-Encoding: br` → `content-encoding: br`, and with `gzip` → `gzip`. A small `GET /health/live` → no `content-encoding`. If categories are empty and too small, seed through Mongo in `beforeAll`: insert 50 categories into the collection the categories service reads (check `src/categories` for the collection name) and delete them in `afterAll`.

**`03-validation-sanitization-errors.conformance.spec.ts`**

- `POST /auth/register` with an extra field `isAdmin: true` → 400, and `message` mentions `isAdmin`.
- Register with missing password → 400, and the envelope has `statusCode`, `timestamp`, `path === '/auth/register'`, `requestId`, `message`.
- Sanitization: `POST /conformance/redaction` `{ payload: { bio: '<script>alert(1)</script>Hi' } }` → `redactedPayload.bio` contains no `<script`.
- JSON body over 1 MiB to `/auth/register` → 413.
- `GET /does-not-exist` → 404 envelope.

- [ ] **Steps:** write 01 → run → triage → write 02 → run → triage → write 03 → run → triage → add CONTRACT.md §1–3 (routes, statuses, headers, envelope as asserted) → commit `test: probes, security headers, validation conformance`.

### Task 10: Suites 04–05 — auth/CSRF and rate limiting (REQ-007 §4–5)

**`04-auth-sessions-csrf.conformance.spec.ts`**

- `GET /auth/csrf` → `{ csrfToken }` plus a `csrf_token` cookie with the same value.
- Register → 201 `{ message: 'User registered successfully' }`. A duplicate email → 409.
- Login → 200 `{ accessToken, sessionId, csrfToken }`. `Set-Cookie` has `access_token` (HttpOnly, Path=/) and `session_id` (HttpOnly, Path=/auth/refresh).
- Wrong password → 401.
- Bearer `GET /conformance/rate-limit/user` → 200. With no token → 401.
- **CSRF:** with cookies only, `POST /auth/logout` and no `x-csrf-token` → 403. With a mismatched token → 403. With the matching token → 200. A Bearer-only logout without cookies → 200 (CSRF does not apply).
- Refresh with the `session_id` cookie → 200, rotates `sessionId` (new ≠ old), and the old `sessionId` refresh → 401.
- **Revocation:** after logout, the old access token on `/conformance/rate-limit/user` → 401.
- **Argon2 bulkhead:** 40 parallel logins from distinct IPs (`ipIndex` 0–39) → every status is 200 or 503. Each 503 has `Retry-After`. No 500s.

**`05-rate-limiting.conformance.spec.ts`**

- `GET /` from a fresh IP: requests 1–3 → 200, request 4 → 429 with a numeric `retry-after` ≥ 1.
- Global IP: from a fresh IP, 10 requests to `/conformance/rate-limit/guest` with fresh guest cookies → the 11th is 429 (the global policy is IP-keyed and runs alongside route policies; triage if the doc says otherwise).
- Guest: no cookie → the response sets `guest_id` (UUID v4). The same cookie four times (distinct IPs) → the 4th is 429. A new cookie → 200.
- Fingerprint: `x-device-fingerprint: fp-A` four times on distinct IPs → the 4th is 429. `fp-B` → 200. A missing header → assert the documented status (read `MissingFingerprintError` mapping; record it in CONTRACT.md).
- User: same user, 4 Bearer calls from distinct IPs → the 4th is 429. A second user → 200.

- [ ] **Steps:** write → run → triage per suite. Add CONTRACT.md §4–5 (cookie names and attributes, CSRF header, rate-limit headers as observed). Commit `test: auth, CSRF and rate-limit conformance`.

### Task 11: Suites 06–07 — feature flags and GraphQL (REQ-007 §6–7)

**`06-feature-flags-rbac.conformance.spec.ts`**

- A regular user: `GET /feature-flags` → 403. `POST` → 403.
- Admin (`loginAsAdmin`): `POST /feature-flags` with a body matching `CreateFeatureFlagDto` (read the DTO for required fields; key `conf-flag-<uuid>`) → 201. `GET /feature-flags/:key` → 200 with the same `enabled`. `PUT` toggles `enabled` → 200. `GET /feature-flags` lists it. `DELETE` with `DeleteFeatureFlagDto` → 200, then `GET /:key` → 404.
- Persistence: Mongo `feature_flag_audits` has ≥ 3 rows for the key (create, update, delete), with the actor email equal to the admin. Redis has a key containing the flag key under the `feature_flags:` prefix after create and none after delete (`SCAN MATCH feature_flags:*conf-flag-<uuid>*`).
- Cookie-auth admin `POST` without CSRF → 403.

**`07-graphql.conformance.spec.ts`**

- `{ categories { id name description } }` → 200, `data.categories` is an array, no `errors`.
- `category(id: "<seeded id>")` → the object. An unknown id → `null`.
- `searchCategories(filter: { name: "<seeded prefix>" })` → a non-empty list.
- Depth 11 (self-nesting through `__type { ofType { ofType … } }`, 11 levels) → `errors[0].message` mentions depth. Depth 9 → no depth error.
- Complexity: a query whose computed complexity exceeds `GQL_MAX_COMPLEXITY` (read the plugin's default and estimator; alias `categories` 200 times) → an error mentioning complexity.
- Concurrency: `GQL_MAX_CONCURRENCY=2`. Fire 6 concurrent slow queries as the same guest (same `guest_id`); there are no slow resolvers, so use 6 heavy aliased queries and accept ≥ 1 rejection) → at least one response is 503 with `Retry-After`. If none ever reject because resolvers are too fast, record F-NNN ("no slow GraphQL resolver to prove concurrency") instead of weakening.
- Invalid query syntax → 400 with an `errors` array.

- [ ] **Steps:** write → run → triage. Add CONTRACT.md §6–7. Commit `test: feature-flag RBAC and GraphQL conformance`.

### Task 12: Suites 08–09 — uploads and WebSockets (REQ-007 §8–9)

**`08-uploads.conformance.spec.ts`** (Bearer auth; build fixtures in-memory: an 8-byte PNG signature plus padding, and `%PDF-1.4` plus padding)

- One PNG `a.png` → 201 or 200 (record which). `files[0]` has `id`, `originalName: 'a.png'`, `mimeType: 'image/png'`, `size`, `scanned`.
- PNG bytes named `a.pdf` → 400 (extension/magic mismatch).
- `MZ` executable bytes named `a.png` → 400.
- 4 files (max 3) → 400. One file of 100 001 bytes → 400 or 413. Three files of 80 000 bytes (total 240 000 > 200 000) → 400 or 413. Record the exact codes and messages in CONTRACT.md. If the boilerplate returns `UPLOAD_REJECT_CODES` in the body, assert the code.
- No auth → 401.

**`09-websockets.conformance.spec.ts`** (`socket.io-client`, namespace `/realtime`, `transports: ['websocket']`; send the auth the handshake service expects. Read `ws-handshake.service.ts`: `auth: { token }` or the `access_token` cookie in `extraHeaders`)

- No token → the server disconnects within 2 s (`disconnect` or `connect_error`).
- A valid token connects. Emitting `join { room: 'user:<ownId>' }` with ack → `{ ok: true, room }`. `join { room: 'user:someoneElse' }` → an `exception` event or error ack containing `Cannot join foreign room`.
- Two sockets of the same user in their room: `message { text: 'hi' }` from A → B receives `message { text: 'hi', from: ownId }`. Another user's socket does not receive it within 500 ms.
- `message { text: '' }` or an extra field → a validation exception, and no broadcast.
- `admin-broadcast` from a regular user → an exception, and nothing received. From an admin → all connected sockets receive `admin-broadcast`.
- Connection cap: a 4th socket for one user (`WEBSOCKET_MAX_CONNECTIONS_PER_USER=3`) is refused or disconnected.
- Message rate: 11 messages within a minute (`WEBSOCKET_MESSAGES_PER_MINUTE=10`) → the 11th triggers a rate-limit exception.

- [ ] **Steps:** write → run → triage. Add CONTRACT.md §8–9 (events, payloads, exception shape). Commit `test: uploads and realtime conformance`.

### Task 13: Suite 10 — jobs, notifications, captcha (REQ-007 §10)

**`10-jobs-notifications-captcha.conformance.spec.ts`**

- Jobs: `POST /example/jobs/echo { message: 'm1', dedupeKey: 'conf-<uuid>' }` → 2xx with a `jobRowId` (record the body shape). Postgres `background_jobs` row `id = jobRowId` reaches `status = 'completed'` within 10 s (poll). Read migration 002 for the column and enum names. A second POST with the same `dedupeKey` → `deduplicated: true` and the same `jobRowId`. A missing `message` → 400.
- Notifications (Bearer): script the mock `/slack` → 200. `POST /example/notification` (body per `CreateExampleNotificationDto`) → `{ status: 'success', operationId, notificationSent: true }`, and the mock recorded 1 request whose body contains `operationId`. Script `/slack` → 500 → response still `status: 'success'`, `notificationSent: false` (fail-open). If the Slack provider refuses a non-`hooks.slack.com` URL so no request reaches the mock, record F-NNN and keep only the fail-open assertion active.
- Captcha: mock `/hcaptcha/*` (match the path the hCaptcha service appends to `HCAPTCHA_VERIFY_BASE_URL`; read `hcaptcha.service.ts`) scripted `{ success: true }` → `POST /example/captcha { captchaToken: 't' }` → 200 `{ message: 'Captcha verification successful' }`. `{ success: false }` → 400. Status 500 → 503. A malformed body (`'nope'`) → 503. `delayMs` longer than the service timeout → 503.

- [ ] **Steps:** write → run → triage. Add CONTRACT.md §10. Commit `test: jobs, notification and captcha conformance`.

### Task 14: Suites 11–13 — cache, HTTP client, overload/deadline/country (REQ-007 §11–13)

**`11-cache-resilience.conformance.spec.ts`** (each test uses key `conf-<uuid>` and `DELETE`s it after)

- Miss then hit: `loaderCallCount` 1 then 1, `isFromLoader` true then false.
- SWR: `softTtlMs: 200, hardTtlMs: 5000`. Wait 300 ms, call with `value: 'v2'` → returns the old `'v1'` immediately (`isFromLoader: false`). Within 500 ms the next call returns `'v2'` (`loaderCallCount: 2`).
- Hard expiry: `softTtlMs: 100, hardTtlMs: 200`. Wait 300 ms → `isFromLoader: true`.
- Stampede: 10 parallel calls, `loaderDelayMs: 200` → every response has `loaderCallCount: 1`.
- Cross-instance lock (Redis): the same as stampede, plus Redis shows a key matching the cache loader-lock prefix while in flight, or after completion only `cache:conformance:<key>` exists. Prefer the post-condition: exactly 1 loader run.
- Negative cache: `value: null, shouldCacheNull: true, negativeSoftTtlMs: 1000, negativeHardTtlMs: 2000` twice → `cachedValue: null`, `loaderCallCount: 1`. Without `shouldCacheNull` → `loaderCallCount: 2`.
- Loader failure → 502, and the next successful call caches normally.
- TTL jitter: if `CACHE_TTL_JITTER_RATIO` is set in the profile, Redis `PTTL` of 5 keys written with the same TTL differs. Otherwise `it.skip` with reason "jitter off in profile". Jitter is not in the pinned profile, so add `CACHE_TTL_JITTER_RATIO=0.2` to `.env.conformance.example` in this task (record under Departures).

**`12-http-client-resilience.conformance.spec.ts`** (mock paths `/upstream/<test-uuid>`)

- Success passthrough: mock `{ hello: 1 }` → `{ upstreamStatus: 200, upstreamBody: { hello: 1 } }`.
- Retry: script `[503, 503, 200]`, `maxRetries: 2, baseDelayMs: 10` → 200, and 3 recorded. `[503 × 4]`, `maxRetries: 2` → 502 with `errorName` in `RetryExhaustedError|HttpError`, and 3 recorded.
- Backoff spacing: with `baseDelayMs: 100` and jitter, the gaps between recorded attempts are each ≤ 100·2^(n−1) + 50 ms. Use full jitter bounds only; no lower bound.
- No retry on 400: script `[400]`, `maxRetries: 2` → 502 `statusCode: 400`, and 1 recorded.
- Circuit breaker: `clientName: 'cb-<uuid>'`, threshold 3, reset 1000, script 500 forever. After 3 calls, the 4th → 503 `CircuitOpenError` and the recorded count is still 3. Wait 1100 ms, script 200 → a half-open probe succeeds → 200.
- Coalescing: `shouldCoalesce: true`, mock `delayMs: 300`, 5 parallel identical calls → all 200, and 1 recorded.
- Concurrency: `maxConcurrent: 2`, mock `delayMs: 300`, 6 parallel calls, distinct query strings to defeat coalescing → the recorded `receivedAt` timestamps show at most 2 requests in any 300 ms window. Total time ≥ 800 ms.
- Deadline propagation: `clientKind: 'internal'`, inbound header `x-request-deadline` set to now+3000 (check `resolve-timeout-ms.ts` for the inbound format: epoch ms or ms budget) → the recorded upstream request has `x-request-deadline`, and its value is ≤ the inbound one. `clientKind: 'external'` without `shouldPropagateDeadline` → the header is absent. With it → present.
- Timeout: `timeoutMs: 100`, mock `delayMs: 500` → 504 `TimeoutError`.
- SSRF: `targetUrl: 'http://169.254.169.254/'` → 400.

**`13-overload-deadline-country.conformance.spec.ts`**

- Deadline: `GET /conformance/deadline/slow?delayMs=3000` with the inbound timeout header at 500 ms → 504 envelope in under 1500 ms. `delayMs=100` with no header → 200 and `remainingBudgetMs` ≤ 5000.
- Max clamp: the timeout header at 60 000 → `remainingBudgetMs` ≤ 10 000 (`REQUEST_TIMEOUT_MAX_MS`).
- Bulkhead plus load leveling: 8 × `GET /conformance/priority/critical?holdMs=1500` in flight (each from a different IP index), then 6 more `normal?holdMs=0`. Some wait in the queue and succeed after the holds release, and once the queue (4) is full, the rest → 503 with `Retry-After`. Assert: no 500s, ≥ 1 × 503 with `Retry-After`, and ≥ 1 queued request succeeded with latency ≥ 1000 ms.
- Priority shedding: with 6 `low?holdMs=1500` in flight, a new `low` → 503 and a new `critical` → 200. Read the shed thresholds in `parse-priority-shedding-config.ts` and pin the in-flight count that triggers `low` shedding but not `critical`.
- Health is exempt under load: during saturation `GET /health/live` → 200.
- Country access (Postgres `country_access`): in `beforeAll`, `INSERT ('US', true)` with `ON CONFLICT` update, then wait 1500 ms. `X-Forwarded-For: 8.8.8.8` (US in GeoLite2) → `GET /conformance/rate-limit/guest` 200. `81.2.69.142` (GB) → 403 (confirm the status in `country_access.feature.md`). `198.51.100.x` (unknown, policy allow) → 200. `/health/live` from GB → 200 (bypass). In `afterAll`, restore the table to its pre-test rows (snapshot them first).

- [ ] **Steps:** write → run → triage per suite. Add CONTRACT.md §11–13 (including the exact inbound deadline header format). Commit `test: cache, http-client, overload, deadline and country conformance`.

### Task 15: Suite 14 — redaction, tracing, graceful shutdown (REQ-007 §14)

**`14-redaction-and-shutdown.conformance.spec.ts`**

- Redaction response: the payload from Task 6's unit test → the same expectations over HTTP.
- OTLP span scrubbing: `POST /auth/login` with an `authorization: Bearer secret-xyz` header and query `?token=abc`. Within 10 s the mock `/otlp/v1/traces` receives a batch. The decoded body (JSON if the exporter is configured for `http/json`; if protobuf, search the raw bytes) does **not** contain `secret-xyz` or `token=abc`, and does contain `REDACTED` or the redaction marker. No probe spans: a `GET /health/live` produces no span with `http.target` `/health/live`.
- **Graceful shutdown** (only if `config.isDestructiveEnabled && config.shutdownCommand`; otherwise `describe.skip` with reason): start `GET /conformance/deadline/slow?delayMs=3000`, run `shutdownCommand` (for example `docker compose kill -s SIGTERM app`) after 200 ms. Within the drain window `GET /health/ready` → 503 (or a connection refusal only after drain), `GET /health/live` → 503, and the in-flight slow request completes 200.
- Then fill `FINDINGS.md`: one entry per red or `it.fails` test, with `F-NNN | suite/test | expected (doc ref) | actual | suspected cause | boilerplate file`.

- [ ] **Steps:** write → run (`RUN_DESTRUCTIVE=true` last) → triage. Add CONTRACT.md §14. Commit `test: redaction, tracing and shutdown conformance; record findings`.

### Task 16: One-command run and CI

- [ ] `scripts/run-against-nestjs.sh <path-to-boilerplate>`: brings up mongo, redis, postgres (compose file in this repo, `docker-compose.deps.yml`: mongo:8.0, redis:7, postgres:17, ports 27017/6379/5432), applies `migrations/postgres/*.sql` from the target path (excluding `*.down.sql`), starts the target with `.env.conformance.example` merged over its `.env`, waits for `/health/live`, runs `pnpm test`, and tears down.
- [ ] `.github/workflows/conformance.yml`: `workflow_dispatch` with a `target_repo` input. It checks out both repos and runs the script with `RUN_DESTRUCTIVE=true` and `SHUTDOWN_COMMAND`.
- [ ] README: "Porting to a new language: implement every route in CONTRACT.md, start your server with the same env profile, run `pnpm test`."
- [ ] Run the script end to end and paste the summary (passed, failed, `it.fails` with F-refs) into the PR description. Commit `ci: one-command conformance run`.

### Task 17: Retire boilerplate tests now proven by conformance (human-gated)

Candidates only. Each needs explicit human approval **and** a green or `it.fails`-free conformance equivalent: `src/core/csrf/tests/csrf.http.spec.ts` (→ suite 04), `src/core/health/tests/health.ready.http.spec.ts` and `test/contracts/rest/health-ready.contract.spec.ts` (→ 01), `src/core/compression/tests/response-compression.http.spec.ts` (→ 02). Everything else stays because it tests TS/Nest internals.

- [ ] For each approved file: delete it, then run `pnpm quality:lint && pnpm quality:types && pnpm test:unit && pnpm quality:contract`. Commit `test: retire HTTP-level specs superseded by conformance suite NN`.

---

## Risks

- **Timing-sensitive suites (11–13) flake on slow CI.** Mitigation: generous upper bounds, never lower bounds on durations, and `retry: 0` (a flake is a finding about the test, so fix the test).
- **GeoLite2 data drift** can move 8.8.8.8 or 81.2.69.142. Pin the IPs in config (`COUNTRY_US_IP`, `COUNTRY_GB_IP`) so they can be swapped.
- **No slow GraphQL resolver**, so concurrency 503s may be unprovable. That is recorded as a finding, not faked.
- **Shared Redis and Mongo state across runs.** Every key and row uses a `conf-<uuid>` prefix and is cleaned up in `afterAll`.

## Proof

Part A per task: targeted spec, then `pnpm quality:lint`, `pnpm quality:types`, `pnpm test:unit`. After Task 7: `scripts/verify.sh`. Part B: `scripts/run-against-nestjs.sh ../nestjs_backend_boilerplate` output, and `FINDINGS.md` reviewed by the human.

## Departures from plan

(append during build)

## Rollback

Part A: `git revert` the commits. The module is not imported unless the env flag is set, so production is unaffected. Part B is a separate repo with no deploy.

## Flag and rollout

`CONFORMANCE_HARNESS_ENABLED` (default `false`, refused in production). No staged rollout; it is test-only.

## Observability

Not applicable in production (the harness is off). In conformance runs, Winston logs from `/conformance/redaction` and mock-upstream recordings are the evidence.

## Docs impact

`docs/features/conformance_harness.feature.md` (new), `docs/features/features.md`, `docs/quality/README.md`, `.env.example`, `.env.conformance.example`, `intent/README.md`. Conformance repo: `README.md`, `CONTRACT.md`, `FINDINGS.md`.

## Definition of done

- REQ-001…006 each have a boilerplate unit test that fails without the change. REQ-007 has 14 suites plus a self-test, run end to end against the boilerplate.
- Every failing conformance assertion is either fixed in the test (test bug) or tracked in `FINDINGS.md` and referenced by an `it.fails` title. No assertion is loosened.
- `CONTRACT.md` documents every route, status, header, cookie and event the suites assert.
- Lint, types, unit and `scripts/verify.sh` are green in the boilerplate. Reviews go to the readonly agents (architect, security-reviewer for the SSRF and production gate, test-engineer, code-reviewer). The builder does not review its own work.
