# ESLint Zero Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear all 70 ESLint warnings from `pnpm quality:lint` (0 errors, 0 warnings) without weakening security posture or disabling rules repo-wide.

**Architecture:** Warnings fall into three buckets: (1) **41×** `security/detect-object-injection` from dynamic `record[key]` reads/writes—fix via `Object.fromEntries`, small typed accessors for cookies/headers, or a single audited helper where bracket access is unavoidable; (2) **SonarJS style/complexity**—refactor locally (extract helpers, remove redundant checks, flatten ternaries); (3) **test-only noise**—use project-local paths, async probes, or spec-scoped rule overrides already used in `eslint.config.mjs`. Re-run `pnpm exec eslint "<paths>"` after each task before the full gate.

**Tech Stack:** ESLint 9 flat config (`eslint.config.mjs`), `eslint-plugin-security`, `eslint-plugin-sonarjs`, TypeScript, Jest, pnpm.

## Global Constraints

- Node **24.9+** (`.nvmrc`); package manager **pnpm only**; never hand-edit `pnpm-lock.yaml`.
- Lint gate: `pnpm quality:lint` → `eslint "{src,apps,libs}/**/*.ts"`.
- Do not disable ESLint/Semgrep security rules without a **one-line comment stating why** (`AGENTS.md`).
- Prefer `@/` imports and naming per `.cursor/rules/elaborate-naming.mdc` (no placeholder ids: `data`, `result`, `item`, …).
- Before calling done: `pnpm quality:lint`, `pnpm quality:types`, `pnpm test:unit` (report results).
- No drive-by refactors outside files listed in each task.

## Warning inventory (baseline)

Run once and keep output for diff:

```bash
pnpm exec eslint "{src,apps,libs}/**/*.ts" --format json -o /tmp/eslint-baseline.json
node -e "const j=require('/tmp/eslint-baseline.json'); console.log(j.flatMap(f=>f.messages.filter(m=>m.severity===1)).length)"
```

Expected: **70** warnings. By rule:

| Rule                                      | Count |
| ----------------------------------------- | ----: |
| `security/detect-object-injection`        |    41 |
| `sonarjs/slow-regex`                      |     5 |
| `sonarjs/different-types-comparison`      |     4 |
| `sonarjs/cognitive-complexity`            |     3 |
| `sonarjs/publicly-writable-directories`   |     2 |
| `sonarjs/no-nested-template-literals`     |     2 |
| `sonarjs/function-return-type`            |     2 |
| `security/detect-non-literal-regexp`      |     1 |
| `security/detect-unsafe-regex`            |     1 |
| `sonarjs/no-hardcoded-ip`                 |     1 |
| `sonarjs/no-invariant-returns`            |     1 |
| `security/detect-possible-timing-attacks` |     1 |
| `sonarjs/os-command`                      |     1 |
| `sonarjs/no-nested-conditional`           |     1 |
| `sonarjs/void-use`                        |     1 |
| `sonarjs/hashing`                         |     1 |
| `sonarjs/no-clear-text-protocols`         |     1 |
| `sonarjs/no-all-duplicated-branches`      |     1 |

---

### Task 1: Dynamic record helpers (foundation)

**Files:**

- Create: `src/common/utils/dynamic-record.utils.ts`
- Create: `src/common/utils/tests/dynamic-record.utils.spec.ts`
- Modify: `src/common/utils/object.utils.ts` (use helper in `withoutUndefined`)
- Modify: `src/common/utils/index.ts` (barrel export if present; else export from call sites only)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `readStringRecordField(record: Record<string, unknown> | undefined, fieldName: string): string | undefined`
  - `readCookieField(cookies: Record<string, string> | undefined, cookieName: string): string | undefined`
  - `assignStringRecordField(target: Record<string, unknown>, fieldName: string, value: unknown): void` — only for cases where `Object.fromEntries` is impractical; document why in file header.
  - `buildRecordFromEntries<T>(entries: [string, T][], mapEntry: (key: string, value: T) => [string, unknown]): Record<string, unknown>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/common/utils/tests/dynamic-record.utils.spec.ts
import {
  readCookieField,
  readStringRecordField,
  buildRecordFromEntries,
} from '../dynamic-record.utils';

describe('dynamic-record.utils', () => {
  it('readStringRecordField returns string when present', () => {
    expect(
      readStringRecordField({ authorization: 'Bearer x' }, 'authorization'),
    ).toBe('Bearer x');
  });

  it('readCookieField reads session cookie by name constant', () => {
    expect(readCookieField({ session_id: 'abc' }, 'session_id')).toBe('abc');
  });

  it('buildRecordFromEntries maps without bracket assignment', () => {
    const built = buildRecordFromEntries(
      [
        ['a', 1],
        ['b', undefined],
      ],
      (key, value) => [key, value === undefined ? 'omit' : value],
    );
    expect(built).toEqual({ a: 1, b: 'omit' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest --config jest.config.ts src/common/utils/tests/dynamic-record.utils.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement helpers**

Implement `dynamic-record.utils.ts` using `Object.fromEntries` for builds and explicit parameter names (`fieldName`, `cookieName`) for reads. For `assignStringRecordField`, if bracket assignment is still required, wrap **once** in that function with:

```typescript
// eslint-disable-next-line security/detect-object-injection -- fieldName is a fixed app constant at call sites, not user input
target[fieldName] = value;
```

- [ ] **Step 4: Refactor `withoutUndefined` to use `buildRecordFromEntries`**

Replace the `pickedFields[key] = value` loop in `object.utils.ts` with filtering + `Object.fromEntries`.

- [ ] **Step 5: Run tests**

Run: `pnpm exec jest --config jest.config.ts src/common/utils/tests/dynamic-record.utils.spec.ts src/common/utils/tests/object.utils.spec.ts` (add object test file only if none exists; run any existing object utils tests).
Expected: PASS.

- [ ] **Step 6: Lint touched files**

Run: `pnpm exec eslint "src/common/utils/**/*.ts"`
Expected: 0 warnings in those files (removes warning at `object.utils.ts:19`).

- [ ] **Step 7: Commit**

```bash
git add src/common/utils/dynamic-record.utils.ts src/common/utils/tests/dynamic-record.utils.spec.ts src/common/utils/object.utils.ts
git commit -m "refactor: add dynamic record helpers for lint-safe key access"
```

---

### Task 2: Auth, JWT, and CSRF cookie/header access (4 warnings)

**Files:**

- Modify: `src/auth/auth.controller.ts:102,141`
- Modify: `src/auth/strategies/jwt.strategy.ts:19`
- Modify: `src/core/csrf/helpers/should-enforce-csrf.ts:12,16,31`
- Modify: `src/core/csrf/middleware/csrf.middleware.ts:95`

**Interfaces:**

- Consumes: `readCookieField`, `readStringRecordField` from Task 1.

- [ ] **Step 1: Replace cookie reads**

Example for `auth.controller.ts`:

```typescript
import { readCookieField } from '@/common/utils/dynamic-record.utils';

const incomingSessionId =
  readCookieField(req.cookies, SESSION_ID_COOKIE) || sessionIdBody;
```

Apply the same pattern for logout and JWT strategy payload/cookie access.

- [ ] **Step 2: Replace header reads in `should-enforce-csrf.ts`**

Use `readStringRecordField(headers, 'authorization')` and lowercase variant via a second call with normalized name, or extend helper with optional `fieldNames: string[]` try-order.

- [ ] **Step 3: Fix `csrf.middleware.ts` dynamic access** (same helpers or `Object.fromEntries`).

- [ ] **Step 4: Lint**

Run: `pnpm exec eslint "src/auth/**/*.ts" "src/core/csrf/**/*.ts"`
Expected: 0 warnings in those paths.

- [ ] **Step 5: Run unit tests**

Run: `pnpm exec jest --config jest.config.ts src/core/csrf src/auth --passWithNoTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix: lint-safe cookie and header access in auth and csrf"
```

---

### Task 3: Redaction module (8 warnings)

**Files:**

- Modify: `src/core/redaction/redact-deep.ts:52,55`
- Modify: `src/core/redaction/redact-headers.ts:16`
- Modify: `src/core/redaction/redact-query.ts:12`
- Modify: `src/core/redaction/redact-otel-attributes.ts:26` (`sonarjs/function-return-type`)
- Modify: `src/core/redaction/redact-log-message.ts:4` (`sonarjs/slow-regex`)
- Modify: `src/core/redaction/redact-url.ts:8` (`sonarjs/no-clear-text-protocols`)

**Interfaces:**

- Consumes: `buildRecordFromEntries` from Task 1.

- [ ] **Step 1: Refactor `redactForLog` object branch**

Replace mutable `out[key] = …` with:

```typescript
return Object.fromEntries(
  Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    isSensitiveLogKey(key) ? REDACTED : redactForLog(child, depth + 1, seen),
  ]),
);
```

- [ ] **Step 2: Apply same pattern in `redact-headers.ts` and `redact-query.ts`**

- [ ] **Step 3: Fix `redactOtelAttributeValue` return type**

Ensure every branch returns `RedactedOtelAttributeValue | undefined` without falling through to `JSON.stringify` mixed paths ambiguously—extract `redactOtelStringValue(key: string, value: string): string` helper so Sonar sees one return type per function.

- [ ] **Step 4: `redact-log-message.ts` slow regex**

Replace catastrophic backtracking pattern with a linear-time alternative (e.g. split on delimiters, or use `RegExp` with possessive-style rewrite / atomic grouping equivalent in JS: simplify to `/\b(token|password)=([^&\s]+)/gi` with bounded repetition). Add a unit test in `src/core/redaction/tests/` proving redaction still works.

- [ ] **Step 5: `redact-url.ts` clear-text protocol**

Use a constant base URL for relative resolution:

```typescript
const REDACT_RELATIVE_URL_BASE = 'https://redact.invalid';
// ...
: new URL(url, REDACT_RELATIVE_URL_BASE);
```

- [ ] **Step 6: Lint + test**

Run: `pnpm exec eslint "src/core/redaction/**/*.ts"`
Run: `pnpm exec jest --config jest.config.ts src/core/redaction/tests --passWithNoTests`
Expected: PASS, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git commit -am "fix: clear redaction module eslint warnings"
```

---

### Task 4: Rate limiter cluster (18 warnings)

**Files:**

- Modify: `src/core/rate-limiter/backends/memory.backend.ts:90,101`
- Modify: `src/core/rate-limiter/backends/redis.backend.ts:44,46,114,128`
- Modify: `src/core/rate-limiter/guards/rate-limit.guard.ts:49` (complexity 22 → ≤20)
- Modify: `src/core/rate-limiter/guards/tests/rate-limit.guard.spec.ts:39`
- Modify: `src/core/rate-limiter/keys/hash-route-scope.ts:12` (`sonarjs/hashing`)
- Modify: `src/core/rate-limiter/keys/route-scope.ts:22,23`
- Modify: `src/core/rate-limiter/middleware/guest-id.middleware.ts:61,69,116`
- Modify: `src/core/rate-limiter/trackers/guest-tracker.ts:14`

**Interfaces:**

- Consumes: Task 1 helpers; existing `resolveRouteScope`, `buildRateLimitKey`.

- [ ] **Step 1: Object injection in backends/middleware**

Prefer `Map<string, …>` for in-memory counters where keys are dynamic, or `Object.fromEntries` when rebuilding objects. For Redis Lua arg maps, consolidate dynamic key assignment into one small function with a documented eslint exception if required.

- [ ] **Step 2: `hash-route-scope.ts` hashing warning**

Switch to SHA-256 (still non-cryptographic use—key shortening only):

```typescript
return createHash('sha256').update(routeScope).digest('hex').slice(0, 16);
```

Update any tests/snapshots that assert exact hash length/prefix if present.

- [ ] **Step 3: `route-scope.ts`**

- Line 22: replace trailing-slash regex with `path.replace(/\/+$/, '')` only if already safe, or use `path.endsWith('/')` loop / `while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)`.
- Line 23: remove nested template literal:

```typescript
const normalizedPath = path.startsWith('/') ? path : `/${path}`;
return `${method}:${normalizedPath}`;
```

- [ ] **Step 4: Reduce `rate-limit.guard.ts` cognitive complexity**

Extract from `canActivate`:

- `resolveTrackerOrThrow(context, method, options)`
- `consumeForMethod(context, method, …)` returning void or throw

Keep behavior identical; run existing guard tests.

- [ ] **Step 5: Lint + unit tests**

Run: `pnpm exec eslint "src/core/rate-limiter/**/*.ts"`
Run: `pnpm exec jest --config jest.config.ts src/core/rate-limiter --passWithNoTests`
Expected: 0 warnings, PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix: rate limiter eslint warnings and guard complexity"
```

---

### Task 5: HTTP client module (7 warnings)

**Files:**

- Modify: `src/core/http-client/auth/oauth-token-manager.ts:165`
- Modify: `src/core/http-client/resilience/coalescing.ts:114`
- Modify: `src/core/http-client/runtime/client-runtime.ts:247,579`
- Modify: `src/core/http-client/telemetry/tracing.ts:107`
- Modify: `src/core/http-client/transport/connection-pool.registry.ts:63`
- Modify: `src/core/http-client/transport/request-builder.ts:248`

- [ ] **Step 1: Object injection sites**

Use `Map` for in-flight coalescing keys or `Object.fromEntries` when cloning metadata objects.

- [ ] **Step 2: Nested ternary at `client-runtime.ts:247`**

Replace with explicit `if/else`:

```typescript
let isFailure: boolean;
if (isCircuitOpenError) {
  isFailure = false;
} else if (isHalfOpen) {
  isFailure = true;
} else {
  isFailure = isBreakerFailure(
    error,
    this.policy.retry?.isTransient ?? defaultIsTransient,
  );
}
```

- [ ] **Step 3: Redundant `body !== null` at line 579**

After `body == null` guard, use:

```typescript
if (typeof body === 'object') {
```

(remove `&& body !== null`).

- [ ] **Step 4: `connection-pool.registry.ts` void operator**

Replace `void this.foo()` with `.catch()` on the promise or assign to `_unusedPromise` with `void` removed—prefer `void promise` → `promise.catch((error) => this.logger.warn(...))` if fire-and-forget must log failures.

- [ ] **Step 5: Lint + tests**

Run: `pnpm exec eslint "src/core/http-client/**/*.ts"`
Run: `pnpm exec jest --config jest.config.ts src/core/http-client/tests --passWithNoTests`
Expected: 0 warnings, PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix: http-client eslint warnings"
```

---

### Task 6: Common layer — filters, config, sanitization, uploads (14 warnings)

**Files:**

- Modify: `src/common/filters/all-exceptions.filter.ts:39,68,69`
- Modify: `src/common/config/validate-env.ts:26`
- Modify: `src/common/config/tests/validate-env.spec.ts:88,90`
- Modify: `src/common/plugins/complexity.plugin.ts:116`
- Modify: `src/common/sanitization/constants/sql-injection.constants.ts:13`
- Modify: `src/common/sanitization/utils/sanitization.utils.ts:25,91`
- Modify: `src/common/sanitization/utils/ssrf.utils.ts:90,108`
- Modify: `src/common/uploads/scanners/clamav-file-scanner.ts:48,98`
- Modify: `src/common/uploads/validate-upload-files.ts:150`

- [ ] **Step 1: `all-exceptions.filter.ts`**

- Extract DB error detection to `private isDatabaseConnectionError(exception: unknown): boolean` to drop cognitive complexity below 20.
- Fix different-types comparison on lines 68–69:

```typescript
const exceptionName = get(exceptionObj, 'name');
const isMongooseSelectionError =
  typeof exceptionName === 'string' &&
  exceptionName === 'MongooseServerSelectionError';
```

(same for `MongoNetworkError`).

- [ ] **Step 2: `validate-env.ts` + spec**

Use fixed-key env lookup (`process.env[variableName]` → switch over known keys or `Object.hasOwn(process.env, key)` pattern with helper). For spec line 90 `detect-non-literal-regexp`, build RegExp from static string template only after validating pattern is from fixture constant.

- [ ] **Step 3: SQL injection patterns**

Add to `eslint.config.mjs` file override (mirror existing block for this file):

```javascript
{
  files: ['src/common/sanitization/constants/sql-injection.constants.ts'],
  rules: {
    'no-useless-escape': 'off',
    'sonarjs/slow-regex': 'off',
    'security/detect-unsafe-regex': 'off', // heuristic SQLi patterns; not user-controlled regex
  },
},
```

Comment in config: defense-in-depth heuristics, patterns are static.

- [ ] **Step 4: `sanitization.utils.ts`**

Extract nested logic to reduce complexity; fix object injection via `Object.fromEntries`.

- [ ] **Step 5: `ssrf.utils.ts`**

- Slow regex: anchor and bound repetitions; avoid nested quantifiers.
- Hardcoded IP line 108: use documentation example IP from RFC 5737 (`203.0.113.10`) in comment and variable name `EXAMPLE_DOCUMENTATION_IP`, or read from test fixture—if still flagged, add file-level sonar disable for that constant with comment "RFC 5737 TEST-NET-3 example only".

- [ ] **Step 6: ClamAV scanner regex + upload validation**

Same slow-regex treatment: simplify patterns; use `validate-upload-files` helper for dynamic MIME map access.

- [ ] **Step 7: Lint + tests**

Run: `pnpm exec eslint "src/common/**/*.ts"`
Run: `pnpm exec jest --config jest.config.ts src/common --passWithNoTests`
Expected: 0 warnings in `src/common`, PASS.

- [ ] **Step 8: Commit**

```bash
git commit -am "fix: common module eslint warnings"
```

---

### Task 7: Core services — cache, logger, notification, overload, websocket, deadline (12 warnings)

**Files:**

- Modify: `src/core/cache/cache.service.ts:272,279`
- Modify: `src/core/cache/lock/tests/redis-loader-lock.spec.ts:26`
- Modify: `src/core/captcha/tests/hcaptcha.service.spec.ts:26`
- Modify: `src/core/feature-flag/tests/feature-flag.repository.spec.ts:23`
- Modify: `src/core/logger/logger.config.ts:29,86`
- Modify: `src/core/notification/providers/slack-message.formatter.ts:39`
- Modify: `src/core/overload/priority/should-shed-priority-request.ts:38`
- Modify: `src/core/request-deadline/helpers/resolve-timeout-ms.ts:15`
- Modify: `src/core/request-deadline/interceptors/tests/request-deadline.interceptor.spec.ts:94`
- Modify: `src/core/request-deadline/middleware/tests/request-deadline.middleware.spec.ts:30`
- Modify: `src/core/websocket/config/parse-websocket-config.ts:26`
- Modify: `src/core/websocket/rate-limit/ws-connection-limiter.service.ts:45,47`

- [ ] **Step 1: `cache.service.ts`**

- `no-invariant-returns` / `different-types-comparison`: inspect `executeLoader` and peer-wait helper—ensure branches return structurally distinct values or split functions so Sonar no longer flags invariant return.
- Line 279: compare `value == null` instead of `value === null` if types include `undefined`, or narrow `T` first.

- [ ] **Step 2: `parse-websocket-config.ts` `resolveCorsOrigins`**

Return a single discriminated type internally:

```typescript
type CorsOriginConfig = { mode: 'allow-all' } | { mode: 'list'; origins: string[] };

function resolveCorsOrigins(...): CorsOriginConfig { ... }

// parseWebSocketConfig maps to Socket.IO shape:
corsOrigins:
  resolved.mode === 'allow-all' ? true : resolved.origins,
```

- [ ] **Step 3: Logger, notification, overload, websocket limiter**

Apply Task 1 helpers / `Object.fromEntries` for dynamic keys. Fix nested template literal in `logger.config.ts:86` by building string in steps.

- [ ] **Step 4: Test fixes**

| File                                                                | Fix                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redis-loader-lock.spec.ts` timing attack                           | Use `crypto.timingSafeEqual` in production code under test, or compare fixed-length buffers in spec; if testing error paths only, mock comparator.                                                                                    |
| `hcaptcha.service.spec.ts`                                          | Replace bracket env access with helper.                                                                                                                                                                                               |
| `feature-flag.repository.spec.ts` os-command                        | Replace `execSync` probe with `await` + `net.createConnection({ host, port })` and Promise timeout (align with comment about blocking probe).                                                                                         |
| `request-deadline.interceptor.spec.ts:94`                           | Replace duplicated ternary with `jest.fn()` returning `undefined` or single mock implementation.                                                                                                                                      |
| `request-deadline.middleware.spec.ts:30`                            | Use helper for dynamic mock request field.                                                                                                                                                                                            |
| Country access specs (`maxmind` / `country-access.service.spec.ts`) | Replace `geoipDatabasePath: '/tmp/...'` with `path.join(os.tmpdir(), 'geolite2-country.mmdb')` **only if** Sonar still flags `os.tmpdir()`—otherwise use project fixture path `test/fixtures/geoip/placeholder.mmdb` created in repo. |

- [ ] **Step 5: Lint + tests**

Run targeted eslint on modified paths; run related jest suites.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix: core service and spec eslint warnings"
```

---

### Task 8: Final gate and docs touch

**Files:**

- Modify: `eslint.config.mjs` (only if Task 6 SQL override added)
- Optional: `docs/quality/README.md` — one sentence that `quality:lint` must report 0 warnings

- [ ] **Step 1: Full lint**

Run: `pnpm quality:lint`
Expected: `✖ 0 problems (0 errors, 0 warnings)`.

- [ ] **Step 2: Types + unit**

Run: `pnpm quality:types`
Run: `pnpm test:unit`
Expected: PASS.

- [ ] **Step 3: Commit any remaining doc/config**

```bash
git commit -am "chore: eslint zero warnings gate"
```

---

## Self-review (plan vs goal)

**Spec coverage:** Every warning in the baseline inventory maps to Task 1–8 file lists. SQL `security/detect-unsafe-regex` covered in Task 6 config override; country-access `/tmp` specs in Task 7.

**Placeholder scan:** No TBD steps; each task names files, line numbers, and concrete patterns.

**Type consistency:** `readCookieField` / `readStringRecordField` used consistently in Tasks 2–7; `CorsOriginConfig` mapping documented for websocket config.

**Risk notes for implementers:**

- Do not change rate-limit hash outputs without checking Redis key migration (SHA-1 → SHA-256 changes key segments—acceptable for this boilerplate if no production data dependency; note in commit if external systems depend on old hashes).
- Prefer refactors over blanket `eslint-disable`; when disabling, one line + reason per `AGENTS.md`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-29-eslint-zero-warnings.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
