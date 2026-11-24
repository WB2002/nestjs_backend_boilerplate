# OTel Redaction, Deadline Header Propagation & HTTP Load Leveling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three remaining boilerplate gaps: redact sensitive data in OpenTelemetry span attributes (including auto HTTP instrumentation), propagate inbound `x-request-deadline` on outbound `HttpClient` calls when configured, and add optional bounded HTTP admission queuing (“load leveling”) before the inbound bulkhead hard-cap.

**Architecture:** (1) Extend `src/core/redaction/` with OTel attribute redaction and wrap the OTLP trace exporter so every exported span is scrubbed; reuse `LOG_REDACTION_ENABLED` as the master switch. (2) Add pure helpers under `src/core/request-deadline/` and merge deadline headers in `ClientRuntime` after inbound ALS merge—default **on** for `internal` clients, **off** for `external`, overridable via `.addDeadlinePropagation()`. (3) Extend `InboundBulkheadService` with a priority-aware wait queue; switch `InboundPriorityBulkheadGuard` to async `canActivate` that waits up to `INBOUND_LOAD_LEVEL_MAX_WAIT_MS` (capped by inbound `remainingMs()`) before fail-fast 503.

**Tech Stack:** NestJS 12, Fastify 5, OpenTelemetry SDK (`@opentelemetry/sdk-node`, `@opentelemetry/sdk-trace-base`), existing `src/core/redaction`, `src/core/request-deadline`, `src/core/http-client`, `src/core/overload`, Jest (`pnpm test:unit`).

## Global Constraints

- **Runtime:** Node **24.9+** (`.nvmrc`); package manager **pnpm** only.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Tests:** `pnpm test:unit` (Jest with `--experimental-vm-modules`).
- **Redaction placeholder:** Literal `[REDACTED]` (match logs and HttpClient telemetry).
- **Log/OTel redaction default:** On when `LOG_REDACTION_ENABLED` is unset; opt out with `LOG_REDACTION_ENABLED=false`.
- **Health probes:** `/health`, `/health/ready` stay exempt from bulkhead, load-level queue, and priority shedding (existing decorators + `isPressureExemptPath`).
- **Overload HTTP semantics:** Load-level queue full / wait timeout → **503** + **`Retry-After`**; **429** remains rate-limit quota only.
- **Load leveling default:** **Off** (`INBOUND_LOAD_LEVELING_ENABLED=false`) to preserve today’s fail-fast behavior until explicitly enabled.

---

## File map

| Epic               | Create                                                                                                                                                                                                                                                      | Modify                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OTel redaction     | `src/core/redaction/redact-otel-attributes.ts`, `redact-otel-attributes.spec.ts`, `src/core/telemetry/redacting-span-exporter.ts`, `redacting-span-exporter.spec.ts`                                                                                        | `src/instrumentation.ts`, `src/core/http-client/telemetry/tracing.ts`, `src/core/redaction/index.ts`, `docs/features/pii_log_redaction.feature.md`, `docs/features/observability.feature.md`, `docs/features/features.md`                                                                                                                                                                                               |
| Deadline header    | `src/core/request-deadline/helpers/outbound-deadline-header.ts`, `outbound-deadline-header.spec.ts`, `src/core/http-client/resilience/outbound-deadline-header.ts`                                                                                          | `src/core/request-deadline/constants/request-deadline.constants.ts`, `src/core/http-client/types/policy.types.ts`, `src/core/http-client/configured-http-client.ts`, `src/core/http-client/runtime/client-runtime.ts`, `src/core/http-client/http-client.spec.ts`, `docs/features/http_client.feature.md`, `docs/features/features.md`                                                                                  |
| HTTP load leveling | `src/core/overload/load-level/inbound-load-level.types.ts`, `parse-inbound-load-level-config.ts`, `inbound-load-level-queue.ts`, `errors/load-level-queue-full.error.ts`, `errors/load-level-wait-timeout.error.ts`, tests under `src/core/overload/tests/` | `src/core/overload/inbound-bulkhead.service.ts`, `src/core/overload/guards/inbound-priority-bulkhead.guard.ts`, `src/core/overload/overload.module.ts`, `src/core/overload/overload-telemetry.ts`, `src/core/telemetry/telemetry.types.ts`, `src/common/filters/all-exceptions.filter.ts`, `src/common/config/env.schema.ts`, `.env.example`, `docs/operations/edge-vs-app-rate-limits.md`, `docs/features/features.md` |

---

## Epic A — OpenTelemetry span attribute redaction

### Task A1: Pure OTel attribute redaction helpers (TDD)

**Files:**

- Create: `src/core/redaction/redact-otel-attributes.ts`
- Create: `src/core/redaction/redact-otel-attributes.spec.ts`
- Modify: `src/core/redaction/index.ts`

**Interfaces:**

- **Produces:** `redactOtelAttributeValue(key: string, value: unknown): unknown`
- **Produces:** `redactOtelAttributes(attributes: Record<string, unknown>): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

Create `src/core/redaction/redact-otel-attributes.spec.ts`:

```typescript
import { REDACTED } from './constants';
import {
  redactOtelAttributeValue,
  redactOtelAttributes,
} from './redact-otel-attributes';

describe('redactOtelAttributes', () => {
  it('redacts sensitive keys and jwt-like string values', () => {
    const jwt = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiIxIn0',
      'sig',
    ].join('.');
    const out = redactOtelAttributes({
      'http.url': 'https://api.example.com?access_token=sekrit',
      email: 'user@example.com',
      'http.request.headers': JSON.stringify({
        Authorization: `Bearer ${jwt}`,
      }),
      'http.method': 'GET',
    });
    expect(out.email).toBe(REDACTED);
    expect(String(out['http.url'])).not.toContain('sekrit');
    expect(String(out['http.request.headers'])).not.toContain(jwt);
    expect(out['http.method']).toBe('GET');
  });

  it('parses and redacts JSON string header blobs', () => {
    const out = redactOtelAttributeValue(
      'http.request.headers',
      JSON.stringify({ 'X-Api-Key': 'super-secret' }),
    );
    expect(String(out)).toContain(REDACTED);
    expect(String(out)).not.toContain('super-secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/redaction/redact-otel-attributes.spec.ts`
Expected: FAIL (module or exports missing).

- [ ] **Step 3: Implement helpers**

Create `src/core/redaction/redact-otel-attributes.ts`:

```typescript
import type { AttributeValue } from '@opentelemetry/api';
import { redactForLog } from './redact-deep';
import { redactHeaders } from './redact-headers';
import { redactUrl } from './redact-url';
import { isSensitiveLogKey } from './sensitive-keys';
import { REDACTED } from './constants';

const HEADER_JSON_KEYS = new Set([
  'http.request.headers',
  'http.response.headers',
]);

function redactKnownUrlKey(key: string, value: string): string {
  if (key === 'http.url' || key === 'url.full' || key === 'http.target') {
    return redactUrl(value);
  }
  return value;
}

export function redactOtelAttributeValue(
  key: string,
  value: unknown,
): AttributeValue {
  if (value == null) {
    return value as AttributeValue;
  }

  if (typeof value === 'string') {
    if (HEADER_JSON_KEYS.has(key)) {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          return JSON.stringify(
            redactHeaders(parsed as Record<string, string>),
          );
        }
      } catch {
        return redactForLog(value) as string;
      }
    }
    const urlRedacted = redactKnownUrlKey(key, value);
    if (urlRedacted !== value) {
      return urlRedacted;
    }
    if (isSensitiveLogKey(key)) {
      return REDACTED;
    }
    const deep = redactForLog(value);
    return typeof deep === 'string' ? deep : String(deep);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'string' ? String(redactForLog(item)) : item,
    ) as AttributeValue;
  }

  return JSON.stringify(redactForLog(value));
}

export function redactOtelAttributes(
  attributes: Record<string, unknown>,
): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = redactOtelAttributeValue(key, value);
  }
  return out;
}
```

Export from `src/core/redaction/index.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- src/core/redaction/redact-otel-attributes.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/redaction/redact-otel-attributes.ts src/core/redaction/redact-otel-attributes.spec.ts src/core/redaction/index.ts
git commit -m "feat(redaction): add OpenTelemetry span attribute scrubbing helpers"
```

---

### Task A2: Redacting span exporter wrapper (TDD)

**Files:**

- Create: `src/core/telemetry/redacting-span-exporter.ts`
- Create: `src/core/telemetry/tests/redacting-span-exporter.spec.ts`

**Interfaces:**

- **Consumes:** `redactOtelAttributes`, `parseLogRedactionConfig`
- **Produces:** `createRedactingSpanExporter(delegate: SpanExporter, options?: { enabled?: boolean }): SpanExporter`

- [ ] **Step 1: Write the failing test**

Create `src/core/telemetry/tests/redacting-span-exporter.spec.ts`:

```typescript
import type {
  ExportResult,
  ReadableSpan,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { createRedactingSpanExporter } from '../redacting-span-exporter';

function makeSpan(attributes: Record<string, unknown>): ReadableSpan {
  return {
    name: 'test',
    kind: 0,
    spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
    startTime: [0, 0],
    endTime: [0, 0],
    status: { code: 0 },
    attributes,
    links: [],
    events: [],
    duration: [0, 0],
    ended: true,
    resource: { attributes: {} },
    instrumentationLibrary: { name: 'test' },
  } as unknown as ReadableSpan;
}

describe('createRedactingSpanExporter', () => {
  it('redacts attributes before delegating export', () => {
    const exported: ReadableSpan[] = [];
    const delegate: SpanExporter = {
      export(spans, cb) {
        exported.push(...spans);
        cb({ code: 0 } as ExportResult);
      },
      shutdown: async () => undefined,
    };

    const exporter = createRedactingSpanExporter(delegate, { enabled: true });
    const span = makeSpan({ password: 'sekrit', 'http.method': 'GET' });

    exporter.export([span], () => undefined);

    expect(exported[0]?.attributes?.password).toBe('[REDACTED]');
    expect(exported[0]?.attributes?.['http.method']).toBe('GET');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/telemetry/tests/redacting-span-exporter.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement wrapper**

Create `src/core/telemetry/redacting-span-exporter.ts`:

```typescript
import type {
  ExportResult,
  ReadableSpan,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { redactOtelAttributes } from '@/core/redaction/redact-otel-attributes';

export type RedactingSpanExporterOptions = {
  enabled?: boolean;
};

function redactSpan(span: ReadableSpan): ReadableSpan {
  const attributes = redactOtelAttributes(
    span.attributes as Record<string, unknown>,
  );
  const events = span.events.map((event) => ({
    ...event,
    attributes: event.attributes
      ? redactOtelAttributes(event.attributes as Record<string, unknown>)
      : event.attributes,
  }));
  return { ...span, attributes, events };
}

export function createRedactingSpanExporter(
  delegate: SpanExporter,
  options: RedactingSpanExporterOptions = {},
): SpanExporter {
  const enabled = options.enabled ?? true;
  return {
    export(
      spans: ReadableSpan[],
      resultCallback: (result: ExportResult) => void,
    ): void {
      const payload = enabled ? spans.map(redactSpan) : spans;
      delegate.export(payload, resultCallback);
    },
    shutdown(): Promise<void> {
      return delegate.shutdown();
    },
    forceFlush?(): Promise<void> {
      return delegate.forceFlush?.();
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- src/core/telemetry/tests/redacting-span-exporter.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/telemetry/redacting-span-exporter.ts src/core/telemetry/tests/redacting-span-exporter.spec.ts
git commit -m "feat(telemetry): wrap trace exporter to redact span attributes"
```

---

### Task A3: Wire exporter + manual span sites

**Files:**

- Modify: `src/instrumentation.ts`
- Modify: `src/core/http-client/telemetry/tracing.ts`
- Modify: `docs/features/pii_log_redaction.feature.md`
- Modify: `docs/features/features.md` (PII row → Done for OTel when complete)

- [ ] **Step 1: Write failing instrumentation test**

Extend `src/core/telemetry/tests/instrumentation.spec.ts` (or add case) asserting that when OTLP exporter is configured, `registerInstrumentation` wraps exporter when `LOG_REDACTION_ENABLED` is not `false`. Mock `NodeSDK` constructor if existing tests already mock SDK—follow the file’s pattern.

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm test:unit -- src/core/telemetry/tests/instrumentation.spec.ts`
Expected: FAIL until wiring exists.

- [ ] **Step 3: Wire `instrumentation.ts`**

After constructing `OTLPTraceExporter`, wrap:

```typescript
import { createRedactingSpanExporter } from './core/telemetry/redacting-span-exporter';
import { parseLogRedactionConfig } from './core/redaction/parse-log-redaction-config';

// inside registerInstrumentation, when config.otlpEndpoint is set:
const baseExporter = new OTLPTraceExporter({
  url: `${config.otlpEndpoint}/v1/traces`,
});
const redaction = parseLogRedactionConfig(process.env);
sdkOptions.traceExporter = createRedactingSpanExporter(baseExporter, {
  enabled: redaction.enabled,
});
```

In `src/core/http-client/telemetry/tracing.ts`, import `redactOtelAttributes` and wrap attribute objects in `startLogicalTrace` / `startAttemptTrace` before `tracer.startSpan` (defense in depth for clients without OTLP export).

- [ ] **Step 4: Update docs**

In `docs/features/pii_log_redaction.feature.md`, move “OpenTelemetry span attributes” from **Out of scope** to **In scope** and document `LOG_REDACTION_ENABLED` governs OTLP export redaction.

- [ ] **Step 5: Run tests**

Run: `pnpm test:unit -- src/core/telemetry/tests/instrumentation.spec.ts src/core/http-client/telemetry/tracing.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/instrumentation.ts src/core/http-client/telemetry/tracing.ts docs/features/pii_log_redaction.feature.md docs/features/features.md
git commit -m "feat(telemetry): redact OTel spans at export and in HttpClient traces"
```

---

## Epic B — Outbound `x-request-deadline` propagation

### Task B1: Shared deadline header constants and pure resolver (TDD)

**Files:**

- Modify: `src/core/request-deadline/constants/request-deadline.constants.ts`
- Create: `src/core/request-deadline/helpers/outbound-deadline-header.ts`
- Create: `src/core/request-deadline/helpers/outbound-deadline-header.spec.ts`

**Interfaces:**

- **Produces:** `REQUEST_DEADLINE_HEADER` = `'x-request-deadline'`
- **Produces:** `resolveOutboundDeadlineHeaders(input: { propagate: boolean; inboundDeadlineAt?: number; existingHeaders?: Record<string, string | undefined> }): Record<string, string>`

- [ ] **Step 1: Write failing tests**

```typescript
import {
  REQUEST_DEADLINE_HEADER,
  resolveOutboundDeadlineHeaders,
} from './outbound-deadline-header';

describe('resolveOutboundDeadlineHeaders', () => {
  it('returns header when propagate is true and deadline exists', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: 1_700_000_000_000,
      }),
    ).toEqual({ [REQUEST_DEADLINE_HEADER]: '1700000000000' });
  });

  it('does not override caller-provided deadline header', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: 100,
        existingHeaders: { [REQUEST_DEADLINE_HEADER]: '200' },
      }),
    ).toEqual({});
  });

  it('returns empty when propagate is false', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: false,
        inboundDeadlineAt: 100,
      }),
    ).toEqual({});
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `pnpm test:unit -- src/core/request-deadline/helpers/outbound-deadline-header.spec.ts`

- [ ] **Step 3: Implement**

Add to `request-deadline.constants.ts`:

```typescript
export const REQUEST_DEADLINE_HEADER = 'x-request-deadline';
```

Implement `outbound-deadline-header.ts` with the pure function (no Nest imports).

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/core/request-deadline/constants/request-deadline.constants.ts src/core/request-deadline/helpers/outbound-deadline-header.ts src/core/request-deadline/helpers/outbound-deadline-header.spec.ts
git commit -m "feat(deadline): add pure outbound x-request-deadline header resolver"
```

---

### Task B2: HttpClient policy + runtime merge (TDD)

**Files:**

- Modify: `src/core/http-client/types/policy.types.ts`
- Modify: `src/core/http-client/configured-http-client.ts`
- Create: `src/core/http-client/resilience/outbound-deadline-header.ts` (re-export or thin wrapper calling request-deadline helper)
- Modify: `src/core/http-client/runtime/client-runtime.ts`
- Modify: `src/core/http-client/http-client.spec.ts`

**Interfaces:**

- **Produces:** `DeadlinePropagationPolicy { propagateHeader?: boolean }` on `ClientPolicySnapshot`
- **Produces:** `ConfiguredHttpClient.addDeadlinePropagation(policy?: DeadlinePropagationPolicy)`
- **Default:** When `propagateHeader` omitted, `true` if `identity.kind === 'internal'`, else `false`

- [ ] **Step 1: Write failing HttpClient integration test**

Add to `src/core/http-client/http-client.spec.ts`:

```typescript
it('propagates inbound x-request-deadline on internal client by default', async () => {
  let seenDeadline: string | undefined;
  const { server, baseUrl } = await listen((req, res) => {
    seenDeadline = req.headers['x-request-deadline'] as string | undefined;
    res.statusCode = 200;
    res.end('{}');
  });
  try {
    const startedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      DeadlineContext.run(
        {
          signal: new AbortController().signal,
          startedAt,
          deadlineAt: startedAt + 5000,
        },
        {
          clearTimer: () => undefined,
          rescheduleFromStart: () => undefined,
          setReason: () => undefined,
          abort: () => undefined,
        },
        async () => {
          try {
            const client = httpClient
              .internal('downstream')
              .addBaseUrl(baseUrl);
            await client.get('/resource');
            resolve();
          } catch (e) {
            reject(e);
          }
        },
      );
    });
    expect(seenDeadline).toBe(String(startedAt + 5000));
  } finally {
    server.close();
  }
});
```

Add companion test: `external` client does **not** send header unless `.addDeadlinePropagation({ propagateHeader: true })`.

- [ ] **Step 2: Run — FAIL**

Run: `pnpm test:unit -- src/core/http-client/http-client.spec.ts -t 'propagates inbound x-request-deadline'`

- [ ] **Step 3: Implement policy + runtime**

In `policy.types.ts`:

```typescript
export interface DeadlinePropagationPolicy {
  propagateHeader?: boolean;
}

// ClientPolicySnapshot add:
deadlinePropagation?: DeadlinePropagationPolicy;
```

In `configured-http-client.ts`:

```typescript
addDeadlinePropagation(policy: DeadlinePropagationPolicy = {}): ConfiguredHttpClient {
  return this.withPolicy({ deadlinePropagation: policy });
}
```

In `client-runtime.ts`, after `deadlineMerge` block and before coalescing, compute:

```typescript
import { getDeadlineAt } from '../../request-deadline/helpers/request-deadline.helpers';
import { resolveOutboundDeadlineHeaders } from '../../request-deadline/helpers/outbound-deadline-header';

function defaultPropagateHeader(kind: ClientKind): boolean {
  return kind === 'internal';
}

// inside executeLogicalRequest after first `request = ... deadlineMerge`:
const propagate =
  this.policy.deadlinePropagation?.propagateHeader ??
  defaultPropagateHeader(this.policy.identity.kind);
const deadlineHeaders = resolveOutboundDeadlineHeaders({
  propagate,
  inboundDeadlineAt: getDeadlineAt(),
  existingHeaders: request.headers as Record<string, string | undefined>,
});
request = {
  ...request,
  headers: { ...request.headers, ...deadlineHeaders },
};
```

- [ ] **Step 4: Run HttpClient tests — PASS**

Run: `pnpm test:unit -- src/core/http-client/http-client.spec.ts`

- [ ] **Step 5: Update `docs/features/http_client.feature.md`**

Add subsection **Inbound deadline inheritance** documenting signal/`remainingMs()` (existing) plus optional `x-request-deadline` header for downstream Nest services that already read response header / ALS patterns.

- [ ] **Step 6: Commit**

```bash
git add src/core/http-client/types/policy.types.ts src/core/http-client/configured-http-client.ts src/core/http-client/runtime/client-runtime.ts src/core/http-client/http-client.spec.ts docs/features/http_client.feature.md docs/features/features.md
git commit -m "feat(http-client): propagate inbound x-request-deadline to downstreams"
```

---

## Epic C — HTTP load leveling (bounded admission queue)

### Task C1: Config types and env parsing (TDD)

**Files:**

- Create: `src/core/overload/load-level/inbound-load-level.types.ts`
- Create: `src/core/overload/load-level/parse-inbound-load-level-config.ts`
- Create: `src/core/overload/tests/parse-inbound-load-level-config.spec.ts`
- Modify: `src/common/config/env.schema.ts`, `.env.example`

**Interfaces:**

- **Produces:** `InboundLoadLevelConfig { enabled: boolean; maxQueue: number; maxWaitMs: number; pollIntervalMs: number }`
- **Env:** `INBOUND_LOAD_LEVELING_ENABLED` (default false), `INBOUND_LOAD_LEVEL_MAX_QUEUE` (default 100), `INBOUND_LOAD_LEVEL_MAX_WAIT_MS` (default 2000), `INBOUND_LOAD_LEVEL_POLL_MS` (default 25)

- [ ] **Step 1: Write failing parser tests** (mirror `parse-inbound-bulkhead-config.spec.ts` style).

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement parser + types**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/core/overload/load-level/inbound-load-level.types.ts src/core/overload/load-level/parse-inbound-load-level-config.ts src/core/overload/tests/parse-inbound-load-level-config.spec.ts src/common/config/env.schema.ts .env.example
git commit -m "feat(overload): add inbound HTTP load leveling config"
```

---

### Task C2: Priority-aware wait queue (TDD)

**Files:**

- Create: `src/core/overload/load-level/inbound-load-level-queue.ts`
- Create: `src/core/overload/tests/inbound-load-level-queue.spec.ts`

**Interfaces:**

- **Consumes:** `ApiPriorityLevel` (lower number = higher priority)
- **Produces:** class `InboundLoadLevelQueue` with:
  - `enqueue(options: { priority: ApiPriorityLevel; maxWaitMs: number; signal?: AbortSignal }): Promise<void>`
  - `onSlotAvailable(): void` (called from bulkhead `release`)
  - `size: number`, `maxQueue: number`

Queue orders by `(priority asc, enqueuedAt asc)`. Reject with `LoadLevelQueueFullError` when `size >= maxQueue`. On wait exceeding `maxWaitMs` or `AbortSignal`, reject with `LoadLevelWaitTimeoutError` / propagate abort as `RequestCancelledError` if signal is inbound deadline abort (reuse existing request-deadline errors where appropriate).

- [ ] **Step 1: Write failing tests**

Cover: (1) higher priority dequeued first when slot opens; (2) queue full; (3) wait timeout; (4) abort signal cancels wait.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement queue** (no Nest dependencies—pure class + errors)

Create errors:

- `src/core/overload/errors/load-level-queue-full.error.ts`
- `src/core/overload/errors/load-level-wait-timeout.error.ts`

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

---

### Task C3: Integrate queue into `InboundBulkheadService` (TDD)

**Files:**

- Modify: `src/core/overload/inbound-bulkhead.service.ts`
- Modify: `src/core/overload/inbound-bulkhead.types.ts` (inject load-level config token)
- Modify: `src/core/overload/overload.module.ts`
- Create: `src/core/overload/tests/inbound-bulkhead.load-level.spec.ts`

**Interfaces:**

- **Produces:** `async acquire(options: { priority: ApiPriorityLevel; maxWaitMs?: number; signal?: AbortSignal }): Promise<void>`
- **Behavior:** If `tryAcquire()` succeeds, return immediately. If load leveling disabled, throw `OverloadRejectedError`. Else `await queue.enqueue(...)`, then `tryAcquire()` (must succeed).

- [ ] **Step 1: Write failing service tests**

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement acquire + call `queue.onSlotAvailable()` from `release()`**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

---

### Task C4: Async priority bulkhead guard (TDD)

**Files:**

- Modify: `src/core/overload/guards/inbound-priority-bulkhead.guard.ts`
- Modify: `src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts`

- [ ] **Step 1: Update tests for async acquire**

When bulkhead at cap and load leveling on, guard waits then admits; when wait exceeds budget, throws `LoadLevelWaitTimeoutError`.

Compute wait budget:

```typescript
import { remainingMs } from '@/core/request-deadline/helpers/request-deadline.helpers';
import { getRequestSignal } from '@/core/request-deadline/helpers/request-deadline.helpers';

const configuredWait = loadLevelConfig.maxWaitMs;
const budget = remainingMs();
const maxWaitMs =
  budget === undefined ? configuredWait : Math.min(configuredWait, budget);
```

- [ ] **Step 2: Change `canActivate` to `async canActivate(...): Promise<boolean>`**

Replace `tryAcquire()` failure path with `await this.bulkhead.acquire({ priority, maxWaitMs, signal: getRequestSignal() })`.

- [ ] **Step 3: Run guard tests — PASS**

- [ ] **Step 4: Commit**

---

### Task C5: Exception filter, EMF, and ops docs

**Files:**

- Modify: `src/core/telemetry/telemetry.types.ts` — add `ServiceUnavailableReason`: `'inbound_load_level_queue_full' | 'inbound_load_level_wait_timeout'`
- Modify: `src/core/overload/overload-telemetry.ts` — emit helpers (mirror `recordApiPriorityShed503`)
- Modify: `src/common/filters/all-exceptions.filter.ts` + spec
- Modify: `docs/operations/edge-vs-app-rate-limits.md` — row: load leveling queue vs bulkhead hard cap
- Modify: `docs/features/features.md` — queue-based load leveling **Partial → Done** for HTTP when enabled

- [ ] **Step 1: Write failing filter tests** for both new errors → 503 + Retry-After + distinct EMF reason

- [ ] **Step 2: Implement mapping**

- [ ] **Step 3: Run filter + telemetry tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.spec.ts src/core/overload/overload-telemetry.ts src/core/telemetry/telemetry.types.ts docs/operations/edge-vs-app-rate-limits.md docs/features/features.md
git commit -m "feat(overload): surface HTTP load leveling as 503 overload with EMF"
```

---

### Task C6: End-to-end guard integration smoke

**Files:**

- Extend: `src/core/overload/tests/inbound-priority-bulkhead.guard.spec.ts` or add lightweight e2e-style test with mock bulkhead max 1, two concurrent requests, second waits then succeeds when first completes.

- [ ] **Step 1: Write test simulating release waking waiter**

- [ ] **Step 2: Run full unit suite for overload**

Run: `pnpm test:unit -- src/core/overload`

- [ ] **Step 3: Commit**

```bash
git commit -m "test(overload): cover load leveling admission under bulkhead cap"
```

---

## Plan self-review

**Spec coverage:** Each user-requested gap maps to Epic A (OTel), B (deadline header), C (HTTP load leveling).

**Placeholder scan:** No TBD steps; file paths and interfaces named explicitly.

**Type consistency:** `ApiPriorityLevel`, `REQUEST_DEADLINE_HEADER`, and `ServiceUnavailableReason` extended in single tasks before use downstream.

**Scope note:** HTTP load leveling is **opt-in** via env so existing fail-fast overload behavior remains default. Epic B defaults header propagation to **internal** clients only to avoid leaking deadline metadata to third-party APIs.

---

## Suggested execution order

1. Epic A (independent)
2. Epic B (independent)
3. Epic C (touches guard/filter—run after B only if sharing request-deadline helpers in guard; no hard dependency)

Epics A and B can run in parallel worktrees; Epic C should merge after request-deadline helpers are stable.
