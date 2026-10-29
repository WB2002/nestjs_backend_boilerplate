# PII / Log Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize secret/PII redaction in a shared module, apply it to all Winston log output and HTTP access logs, and keep HttpClient telemetry behavior unchanged via re-exports.

**Architecture:** Move existing URL/header/query redaction from `src/core/http-client/telemetry/redaction.ts` into `src/core/redaction/`. Add key-based and pattern-based redaction for nested log metadata (`redactForLog`). Register a Winston format in `logger.config.ts` that redacts `message`, `stack`, and all other info fields before dev/prod formatters run. `LoggingInterceptor` logs redacted URLs only. HttpClient keeps importing from `./telemetry/redaction`, which re-exports the shared module so public exports in `src/core/http-client/index.ts` stay stable.

**Tech Stack:** NestJS 12, Winston 3, nest-winston, Jest 30, TypeScript 5.x, existing `@/` path alias.

## Global Constraints

- **Runtime:** Node **24.18.0** (`.nvmrc`); package manager **pnpm** only.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for enums/unions.
- **Tests:** `pnpm test:unit` (Jest with `--experimental-vm-modules`).
- **Redaction placeholder:** Use literal `[REDACTED]` everywhere (match HttpClient telemetry today).
- **Default behavior:** Redaction **on** when `LOG_REDACTION_ENABLED` is unset; opt out with `LOG_REDACTION_ENABLED=false`.
- **Health probes:** Do not add logging of request bodies on `/health` paths.

---

## File map

| Responsibility   | Create                                                                                                                                                                                                                                           | Modify                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Shared redaction | `src/core/redaction/constants.ts`, `sensitive-keys.ts`, `redact-url.ts`, `redact-headers.ts`, `redact-query.ts`, `redact-value-patterns.ts`, `redact-deep.ts`, `redact-log-message.ts`, `parse-log-redaction-config.ts`, `index.ts`, `*.spec.ts` | —                                                                                |
| HttpClient shim  | —                                                                                                                                                                                                                                                | `src/core/http-client/telemetry/redaction.ts` (re-export only)                   |
| Winston pipeline | —                                                                                                                                                                                                                                                | `src/core/logger/logger.config.ts`, `logger.config.spec.ts` (create)             |
| Access logs      | —                                                                                                                                                                                                                                                | `src/core/logger/logging.interceptor.ts`, `logging.interceptor.spec.ts` (create) |
| Config / env     | —                                                                                                                                                                                                                                                | `src/common/config/env.schema.ts`, `.env.example`                                |
| Docs             | `docs/features/pii_log_redaction.feature.md`                                                                                                                                                                                                     | `docs/features/features.md`, `docs/features/observability.feature.md`            |

---

### Task 1: Shared sensitive-key helpers and URL/header/query redaction

**Files:**

- Create: `src/core/redaction/constants.ts`
- Create: `src/core/redaction/sensitive-keys.ts`
- Create: `src/core/redaction/redact-url.ts`
- Create: `src/core/redaction/redact-headers.ts`
- Create: `src/core/redaction/redact-query.ts`
- Create: `src/core/redaction/index.ts`
- Create: `src/core/redaction/redaction.spec.ts`
- Modify: `src/core/http-client/telemetry/redaction.ts`

**Interfaces:**

- Produces: `REDACTED`, `isSensitiveHeaderName(name: string): boolean`, `isSensitiveQueryKey(name: string): boolean`, `isSensitiveLogKey(name: string): boolean`, `redactUrl(url: string): string`, `redactHeaders(...)`, `redactQuery(...)`.
- `isSensitiveLogKey` returns true for exact keys in a set (password, email, phone, …) **or** when `/secret|token|password|…/i` matches the key name (same spirit as header pattern).

- [ ] **Step 1: Write failing tests for log keys and moved URL redaction**

Create `src/core/redaction/redaction.spec.ts`:

```typescript
import {
  isSensitiveLogKey,
  redactHeaders,
  redactQuery,
  redactUrl,
} from './index';

describe('core redaction (url/header/query)', () => {
  it('treats common log metadata keys as sensitive', () => {
    expect(isSensitiveLogKey('password')).toBe(true);
    expect(isSensitiveLogKey('email')).toBe(true);
    expect(isSensitiveLogKey('refreshToken')).toBe(true);
    expect(isSensitiveLogKey('requestId')).toBe(false);
  });

  it('redacts custom secret headers and URL userinfo/query secrets', () => {
    expect(redactHeaders({ 'X-Partner-Key': 'sekrit' })['X-Partner-Key']).toBe(
      '[REDACTED]',
    );
    const redacted = redactUrl(
      'https://user:pass@example.com/x?access_token=sekrit&ok=1',
    );
    expect(redacted).not.toContain('sekrit');
    expect(redacted).not.toContain('user:pass');
    expect(redacted).toContain('ok=1');
  });

  it('redacts common short query secret names like key and sig', () => {
    expect(redactQuery({ key: 'sekrit', sig: 'abc', ok: 1 })).toEqual({
      key: '[REDACTED]',
      sig: '[REDACTED]',
      ok: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/redaction/redaction.spec.ts`
Expected: FAIL (module `./index` missing or functions not defined).

- [ ] **Step 3: Implement shared module (move logic from HttpClient)**

Create `src/core/redaction/constants.ts`:

```typescript
export const REDACTED = '[REDACTED]' as const;
```

Create `src/core/redaction/sensitive-keys.ts` — copy header/query sets and patterns from current `src/core/http-client/telemetry/redaction.ts`, and add:

```typescript
const SENSITIVE_LOG_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'email',
  'phone',
  'mobile',
  'phonenumber',
  'ssn',
  'socialsecuritynumber',
  'creditcard',
  'cardnumber',
  'cvv',
  'secret',
  'apikey',
  'privatekey',
]);

const SENSITIVE_LOG_KEY_PATTERN =
  /(secret|token|password|passwd|api-?key|(?:^|[-_])key$|auth|credential|ssn|cvv)/i;

export function isSensitiveLogKey(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_LOG_KEYS.has(lower) || SENSITIVE_LOG_KEY_PATTERN.test(lower);
}
```

Implement `redact-url.ts`, `redact-headers.ts`, `redact-query.ts` by moving bodies from `src/core/http-client/telemetry/redaction.ts`, importing `REDACTED` and key helpers from `./sensitive-keys` / `./constants`.

Create `src/core/redaction/index.ts` exporting all public functions.

Replace `src/core/http-client/telemetry/redaction.ts` with:

```typescript
export {
  isSensitiveHeaderName,
  isSensitiveQueryKey,
  isSensitiveLogKey,
  redactHeaders,
  redactQuery,
  redactUrl,
} from '@/core/redaction';
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- src/core/redaction/redaction.spec.ts src/core/http-client/http-client.spec.ts -t "redaction"`
Expected: PASS (HttpClient tests still pass via re-export).

- [ ] **Step 5: Commit**

```bash
git add src/core/redaction src/core/http-client/telemetry/redaction.ts
git commit -m "refactor(redaction): extract shared url/header/query helpers"
```

---

### Task 2: Deep log value redaction (keys + value patterns)

**Files:**

- Create: `src/core/redaction/redact-value-patterns.ts`
- Create: `src/core/redaction/redact-deep.ts`
- Modify: `src/core/redaction/index.ts`
- Modify: `src/core/redaction/redaction.spec.ts`

**Interfaces:**

- Produces: `looksLikeSensitiveValue(value: string): boolean`, `redactForLog(value: unknown, depth?: number): unknown`.
- `redactForLog` walks arrays and plain objects (skip `Date`, `Buffer`, circular refs via `WeakSet`); redacts values when key is sensitive **or** string value matches email/JWT patterns; max depth **8** (deeper nodes replaced with `'[REDACTED_DEPTH]'`).

- [ ] **Step 1: Write failing tests**

Append to `src/core/redaction/redaction.spec.ts`:

```typescript
import { redactForLog } from './redact-deep';

describe('redactForLog', () => {
  it('redacts by object key name', () => {
    expect(
      redactForLog({ email: 'user@example.com', requestId: 'abc' }),
    ).toEqual({
      email: '[REDACTED]',
      requestId: 'abc',
    });
  });

  it('redacts email-like strings even without sensitive key', () => {
    expect(redactForLog({ note: 'contact user@example.com please' })).toEqual({
      note: '[REDACTED]',
    });
  });

  it('redacts jwt-shaped strings', () => {
    const jwt = 'eyJaa.eyJbb.cc';
    expect(redactForLog({ debug: jwt })).toEqual({ debug: '[REDACTED]' });
  });

  it('preserves numbers and booleans', () => {
    expect(redactForLog({ count: 3, ok: true })).toEqual({
      count: 3,
      ok: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/redaction/redaction.spec.ts -t redactForLog`
Expected: FAIL.

- [ ] **Step 3: Implement pattern + deep redaction**

`src/core/redaction/redact-value-patterns.ts`:

```typescript
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function looksLikeSensitiveValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (EMAIL_PATTERN.test(trimmed)) {
    return true;
  }
  if (JWT_PATTERN.test(trimmed)) {
    return true;
  }
  return false;
}
```

`src/core/redaction/redact-deep.ts`:

```typescript
import { REDACTED } from './constants';
import { isSensitiveLogKey } from './sensitive-keys';
import { looksLikeSensitiveValue } from './redact-value-patterns';

const MAX_DEPTH = 8;

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return '[REDACTED_DEPTH]';
  }
  if (
    value == null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return looksLikeSensitiveValue(value) ? REDACTED : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1));
  }
  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (isSensitiveLogKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactForLog(child, depth + 1);
    }
    return out;
  }
  return value;
}
```

Export `redactForLog` from `index.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- src/core/redaction/redaction.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/redaction
git commit -m "feat(redaction): deep log metadata and value pattern masking"
```

---

### Task 3: Redact log message strings (URLs embedded in text)

**Files:**

- Create: `src/core/redaction/redact-log-message.ts`
- Modify: `src/core/redaction/index.ts`
- Modify: `src/core/redaction/redaction.spec.ts`

**Interfaces:**

- Produces: `redactLogMessage(message: string): string` — replaces `https?://…` and `/path?query` substrings using `redactUrl` on each match.

- [ ] **Step 1: Write failing test**

```typescript
import { redactLogMessage } from './redact-log-message';

describe('redactLogMessage', () => {
  it('redacts sensitive query params inside access log lines', () => {
    const line = 'GET /auth/callback?access_token=sekrit&ok=1 302 - 4ms';
    const out = redactLogMessage(line);
    expect(out).not.toContain('sekrit');
    expect(out).toContain('ok=1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/redaction/redaction.spec.ts -t redactLogMessage`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { redactUrl } from './redact-url';

const ABSOLUTE_URL = /https?:\/\/[^\s'"]+/gi;
const RELATIVE_WITH_QUERY = /\/[^\s'"]*\?[^\s'"]+/gi;

export function redactLogMessage(message: string): string {
  let out = message.replace(ABSOLUTE_URL, (match) => redactUrl(match));
  out = out.replace(RELATIVE_WITH_QUERY, (match) => redactUrl(match));
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- src/core/redaction/redaction.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/redaction
git commit -m "feat(redaction): scrub urls embedded in log messages"
```

---

### Task 4: Log redaction config

**Files:**

- Create: `src/core/redaction/parse-log-redaction-config.ts`
- Create: `src/core/redaction/parse-log-redaction-config.spec.ts`
- Modify: `src/common/config/env.schema.ts`
- Modify: `.env.example`

**Interfaces:**

- Produces: `LogRedactionConfig` `{ enabled: boolean }`, `parseLogRedactionConfig(env: Record<string, string | undefined>): LogRedactionConfig`.
- Default: `enabled === true` unless `LOG_REDACTION_ENABLED` is exactly `'false'`.

- [ ] **Step 1: Write failing test**

Create `src/core/redaction/parse-log-redaction-config.spec.ts`:

```typescript
import { parseLogRedactionConfig } from './parse-log-redaction-config';

describe('parseLogRedactionConfig', () => {
  it('defaults to enabled', () => {
    expect(parseLogRedactionConfig({})).toEqual({ enabled: true });
  });

  it('disables when LOG_REDACTION_ENABLED=false', () => {
    expect(parseLogRedactionConfig({ LOG_REDACTION_ENABLED: 'false' })).toEqual(
      { enabled: false },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/redaction/parse-log-redaction-config.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement parser and env schema**

```typescript
export type LogRedactionConfig = {
  enabled: boolean;
};

export function parseLogRedactionConfig(
  env: Record<string, string | undefined>,
): LogRedactionConfig {
  return {
    enabled: env.LOG_REDACTION_ENABLED !== 'false',
  };
}
```

Add to `env.schema.ts`:

```typescript
LOG_REDACTION_ENABLED: { required: false },
```

Add to `.env.example`:

```bash
# Log redaction (secrets/PII in Winston output and access logs). Set false only for local debugging.
LOG_REDACTION_ENABLED=true
```

- [ ] **Step 4: Run test**

Run: `pnpm test:unit -- src/core/redaction/parse-log-redaction-config.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/redaction/parse-log-redaction-config.ts src/core/redaction/parse-log-redaction-config.spec.ts src/common/config/env.schema.ts .env.example
git commit -m "feat(redaction): LOG_REDACTION_ENABLED config"
```

---

### Task 5: Winston format integration

**Files:**

- Create: `src/core/logger/logger.config.spec.ts`
- Modify: `src/core/logger/logger.config.ts`

**Interfaces:**

- Consumes: `parseLogRedactionConfig`, `redactForLog`, `redactLogMessage`.
- Produces: `createRedactionFormat(config: LogRedactionConfig)` winston format that, when enabled, sets `info.message` via `redactLogMessage(String(info.message ?? ''))`, redacts `info.stack` with `redactLogMessage` when string, and redacts every other enumerable key on `info` except Winston internals (`level`, `timestamp`, `splat`, `Symbol(level)`, `Symbol(message)`) using `redactForLog`.

- [ ] **Step 1: Write failing test**

Create `src/core/logger/logger.config.spec.ts`:

```typescript
import winston from 'winston';
import { createRedactionFormat } from './logger.config';

describe('createRedactionFormat', () => {
  it('redacts sensitive metadata fields on the log info object', () => {
    const fmt = createRedactionFormat({ enabled: true });
    const pipeline = winston.format.combine(fmt, winston.format.json());
    const logger = winston.createLogger({
      transports: [new winston.transports.Console({ format: pipeline })],
    });

    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    logger.info('hello', { email: 'a@b.com', requestId: 'rid-1' });
    process.stdout.write = originalWrite;

    const line = chunks.join('');
    expect(line).not.toContain('a@b.com');
    expect(line).toContain('rid-1');
  });
});
```

Export `createRedactionFormat` from `logger.config.ts` for testing (named export alongside `winstonConfig`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/logger/logger.config.spec.ts`
Expected: FAIL (`createRedactionFormat` not exported).

- [ ] **Step 3: Wire format into winstonConfig**

In `logger.config.ts`:

```typescript
import { parseLogRedactionConfig } from '@/core/redaction/parse-log-redaction-config';
import { redactForLog } from '@/core/redaction/redact-deep';
import { redactLogMessage } from '@/core/redaction/redact-log-message';

const WINSTON_RESERVED = new Set(['level', 'message', 'timestamp', 'stack']);

export function createRedactionFormat(config: { enabled: boolean }) {
  return winston.format((info) => {
    if (!config.enabled) {
      return info;
    }
    if (typeof info.message === 'string') {
      info.message = redactLogMessage(info.message);
    }
    if (typeof info.stack === 'string') {
      info.stack = redactLogMessage(info.stack);
    }
    for (const key of Object.keys(info)) {
      if (WINSTON_RESERVED.has(key)) {
        continue;
      }
      info[key] = redactForLog(info[key]);
    }
    return info;
  });
}

const logRedactionConfig = parseLogRedactionConfig(process.env);
const redactionFormat = createRedactionFormat(logRedactionConfig);

const devFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  redactionFormat,
  contextFormatter(),
  // ... rest unchanged
);

const prodFormat = combine(
  timestamp(),
  redactionFormat,
  contextFormatter(),
  json(),
);
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- src/core/logger/logger.config.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/logger/logger.config.ts src/core/logger/logger.config.spec.ts
git commit -m "feat(logger): winston redaction format for metadata and messages"
```

---

### Task 6: HTTP access log line uses redactUrl

**Files:**

- Create: `src/core/logger/logging.interceptor.spec.ts`
- Modify: `src/core/logger/logging.interceptor.ts`

**Interfaces:**

- Consumes: `redactUrl` from `@/core/redaction`, `parseLogRedactionConfig(process.env)`.

- [ ] **Step 1: Write failing test**

Create `src/core/logger/logging.interceptor.spec.ts`:

```typescript
import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  it('logs redacted url when query contains secrets', (done) => {
    const interceptor = new LoggingInterceptor();
    const logSpy = jest
      .spyOn(interceptor['logger'], 'log')
      .mockImplementation((line: string) => {
        expect(line).not.toContain('sekrit');
        expect(line).toContain('/auth/callback');
        logSpy.mockRestore();
        done();
      });

    const req = {
      method: 'GET',
      url: '/auth/callback?access_token=sekrit&ok=1',
    };
    const res = { statusCode: 302 };
    const ctx = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(undefined) };

    interceptor.intercept(ctx, next).subscribe();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/logger/logging.interceptor.spec.ts`
Expected: FAIL (log line still contains `sekrit`).

- [ ] **Step 3: Implement interceptor change**

In `logging.interceptor.ts`:

```typescript
import { redactUrl } from '@/core/redaction';
import { parseLogRedactionConfig } from '@/core/redaction/parse-log-redaction-config';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  private readonly redactionEnabled = parseLogRedactionConfig(process.env)
    .enabled;

  // inside tap():
  const safeUrl =
    this.redactionEnabled && typeof url === 'string' ? redactUrl(url) : url;
  this.logger.log(`${method} ${safeUrl} ${statusCode} - ${delay}ms`);
```

- [ ] **Step 4: Run test**

Run: `pnpm test:unit -- src/core/logger/logging.interceptor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/logger/logging.interceptor.ts src/core/logger/logging.interceptor.spec.ts
git commit -m "feat(logger): redact sensitive query params in access logs"
```

---

### Task 7: Documentation and feature index

**Files:**

- Create: `docs/features/pii_log_redaction.feature.md`
- Modify: `docs/features/features.md`
- Modify: `docs/features/observability.feature.md`

- [ ] **Step 1: Add feature doc**

Create `docs/features/pii_log_redaction.feature.md` covering:

- Scope: Winston logs (all levels), `LoggingInterceptor` access lines, shared helpers used by HttpClient telemetry.
- Not in scope: API JSON response bodies, Mongo/Postgres stored data, OpenTelemetry span attributes (future work).
- Env: `LOG_REDACTION_ENABLED` (default on).
- Extension: add keys to `isSensitiveLogKey` set or value patterns in `redact-value-patterns.ts`.

- [ ] **Step 2: Update feature index**

In `docs/features/features.md`:

- Change **PII tagging / data masking** row from **Missing** to **Done** (or **Partial** if OTel span attrs remain unredacted — use **Partial** with note: app logs + HttpClient; OTel attributes not yet redacted).
- Add row to **Feature index** linking `pii_log_redaction.feature.md`.
- Under **Cross-cutting**, add bullet for log redaction module path `src/core/redaction/`.

- [ ] **Step 3: Link from observability doc**

Add a short section in `observability.feature.md` pointing to `pii_log_redaction.feature.md`.

- [ ] **Step 4: Run full unit suite**

Run: `pnpm test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/features/pii_log_redaction.feature.md docs/features/features.md docs/features/observability.feature.md
git commit -m "docs: PII and log redaction feature"
```

---

## Self-Review

**Spec coverage:**

| Requirement                            | Task   |
| -------------------------------------- | ------ |
| Shared redaction (DRY with HttpClient) | Task 1 |
| Key-based PII in log metadata          | Task 2 |
| Value patterns (email, JWT)            | Task 2 |
| All Winston output                     | Task 5 |
| Access log URLs                        | Task 6 |
| Config toggle                          | Task 4 |
| Documentation                          | Task 7 |

**Out of scope (explicit):** OTel span attribute redaction, `@Redact()` DTO decorator, automatic Nest `Logger` message scanning beyond Winston pipeline, client-facing error JSON path redaction (only logs).

**Placeholder scan:** No TBD steps.

**Type consistency:** `LogRedactionConfig`, `redactForLog`, `createRedactionFormat` names used consistently across tasks.

---

## Execution Handoff

Plan complete and saved to `intent/pii-log-redaction/plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
