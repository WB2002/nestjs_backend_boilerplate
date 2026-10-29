# Outbound `x-request-deadline` Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `x-request-deadline` on outbound `HttpClient` calls when inbound request-deadline ALS is active, defaulting to **on** for `internal` clients and **off** for `external`, overridable via `.addDeadlinePropagation()`.

**Architecture:** Add a pure header resolver in `src/core/request-deadline/` and merge its output in `ClientRuntime` immediately after existing `mergeInboundDeadlineWithPolicy`, using `getDeadlineAt()` as the source of truth. Caller-provided deadline headers are never overwritten.

**Tech Stack:** NestJS 12, existing `DeadlineContext` ALS, `HttpClient` / `ClientRuntime`, Jest (`pnpm test:unit`).

## Global Constraints

- **Runtime:** Node **24.9+** (`.nvmrc`); package manager **pnpm** only.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Tests:** `pnpm test:unit` (Jest with `--experimental-vm-modules`).
- **Header name:** `x-request-deadline` (lowercase key in merged request headers).
- **Header value:** `String(deadlineAt)` absolute epoch ms (match middleware response header).

**Design spec:** `intent/outbound-x-request-deadline-propagation/spec.md`

---

## File map

| Action | Path                                                                      |
| ------ | ------------------------------------------------------------------------- |
| Create | `src/core/request-deadline/helpers/outbound-deadline-header.ts`           |
| Create | `src/core/request-deadline/helpers/outbound-deadline-header.spec.ts`      |
| Create | `src/core/http-client/resilience/outbound-deadline-header.ts` (re-export) |
| Modify | `src/core/request-deadline/constants/request-deadline.constants.ts`       |
| Modify | `src/core/request-deadline/helpers/index.ts`                              |
| Modify | `src/core/http-client/types/policy.types.ts`                              |
| Modify | `src/core/http-client/configured-http-client.ts`                          |
| Modify | `src/core/http-client/runtime/client-runtime.ts`                          |
| Modify | `src/core/http-client/resilience/index.ts`                                |
| Modify | `src/core/http-client/http-client.spec.ts`                                |
| Modify | `docs/features/http_client.feature.md`                                    |
| Modify | `docs/features/features.md`                                               |

---

### Task 1: Constants + pure outbound deadline header resolver (TDD)

**Files:**

- Modify: `src/core/request-deadline/constants/request-deadline.constants.ts`
- Create: `src/core/request-deadline/helpers/outbound-deadline-header.ts`
- Create: `src/core/request-deadline/helpers/outbound-deadline-header.spec.ts`
- Modify: `src/core/request-deadline/helpers/index.ts`

**Interfaces:**

- **Produces:** `REQUEST_DEADLINE_HEADER` = `'x-request-deadline'` (in constants)
- **Produces:** `resolveOutboundDeadlineHeaders(input: { propagate: boolean; inboundDeadlineAt?: number; existingHeaders?: Record<string, string | undefined> }): Record<string, string>`

- [ ] **Step 1: Write the failing test**

Create `src/core/request-deadline/helpers/outbound-deadline-header.spec.ts`:

```typescript
import { REQUEST_DEADLINE_HEADER } from '../constants/request-deadline.constants';
import { resolveOutboundDeadlineHeaders } from './outbound-deadline-header';

describe('resolveOutboundDeadlineHeaders', () => {
  it('returns header when propagate is true and deadline exists', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: 1_700_000_000_000,
      }),
    ).toEqual({ [REQUEST_DEADLINE_HEADER]: '1700000000000' });
  });

  it('returns empty when propagate is true but no inbound deadline', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: undefined,
      }),
    ).toEqual({});
  });

  it('does not override caller-provided deadline header (lowercase)', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: 100,
        existingHeaders: { [REQUEST_DEADLINE_HEADER]: '200' },
      }),
    ).toEqual({});
  });

  it('does not override caller-provided deadline header (mixed case key)', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: 100,
        existingHeaders: { 'X-Request-Deadline': '200' },
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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/core/request-deadline/helpers/outbound-deadline-header.spec.ts`  
Expected: FAIL (module missing or export missing).

- [ ] **Step 3: Implement**

Add to `src/core/request-deadline/constants/request-deadline.constants.ts`:

```typescript
export const REQUEST_DEADLINE_HEADER = 'x-request-deadline';
```

Create `src/core/request-deadline/helpers/outbound-deadline-header.ts`:

```typescript
import { REQUEST_DEADLINE_HEADER } from '../constants/request-deadline.constants';

export interface ResolveOutboundDeadlineHeadersInput {
  propagate: boolean;
  inboundDeadlineAt?: number;
  existingHeaders?: Record<string, string | undefined>;
}

function existingDeadlineHeader(
  headers?: Record<string, string | undefined>,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === REQUEST_DEADLINE_HEADER && value != null) {
      return value;
    }
  }
  return undefined;
}

export function resolveOutboundDeadlineHeaders(
  input: ResolveOutboundDeadlineHeadersInput,
): Record<string, string> {
  if (!input.propagate) {
    return {};
  }
  if (input.inboundDeadlineAt === undefined) {
    return {};
  }
  if (existingDeadlineHeader(input.existingHeaders) !== undefined) {
    return {};
  }
  return {
    [REQUEST_DEADLINE_HEADER]: String(input.inboundDeadlineAt),
  };
}
```

Export from `src/core/request-deadline/helpers/index.ts`:

```typescript
export { resolveOutboundDeadlineHeaders } from './outbound-deadline-header';
export type { ResolveOutboundDeadlineHeadersInput } from './outbound-deadline-header';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- src/core/request-deadline/helpers/outbound-deadline-header.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/request-deadline/constants/request-deadline.constants.ts \
  src/core/request-deadline/helpers/outbound-deadline-header.ts \
  src/core/request-deadline/helpers/outbound-deadline-header.spec.ts \
  src/core/request-deadline/helpers/index.ts
git commit -m "feat(deadline): add pure outbound x-request-deadline header resolver"
```

---

### Task 2: HttpClient policy, runtime merge, and integration tests (TDD)

**Files:**

- Modify: `src/core/http-client/types/policy.types.ts`
- Modify: `src/core/http-client/configured-http-client.ts`
- Create: `src/core/http-client/resilience/outbound-deadline-header.ts`
- Modify: `src/core/http-client/resilience/index.ts`
- Modify: `src/core/http-client/runtime/client-runtime.ts`
- Modify: `src/core/http-client/http-client.spec.ts`

**Interfaces:**

- **Consumes:** `resolveOutboundDeadlineHeaders`, `getDeadlineAt` from request-deadline helpers
- **Produces:** `DeadlinePropagationPolicy { propagateHeader?: boolean }` on `ClientPolicySnapshot`
- **Produces:** `ConfiguredHttpClient.addDeadlinePropagation(policy?: DeadlinePropagationPolicy)`
- **Default:** `propagateHeader` omitted → `true` when `identity.kind === 'internal'`, else `false`

- [ ] **Step 1: Write failing HttpClient integration tests**

Add near the existing `caps outbound work by inbound request deadline remaining` test in `src/core/http-client/http-client.spec.ts`:

```typescript
const deadlineInternals = {
  clearTimer: () => undefined,
  rescheduleFromStart: () => undefined,
  setReason: () => undefined,
  abort: () => undefined,
};

it('propagates inbound x-request-deadline on internal client by default', async () => {
  let seenDeadline: string | undefined;
  const { server, baseUrl } = await listen((req, res) => {
    seenDeadline = req.headers['x-request-deadline'] as string | undefined;
    res.statusCode = 200;
    res.end('{}');
  });

  try {
    const controller = new AbortController();
    const startedAt = Date.now();
    const deadlineAt = startedAt + 5000;
    const store = {
      signal: controller.signal,
      startedAt,
      deadlineAt,
    };

    await new Promise<void>((resolve, reject) => {
      DeadlineContext.run(store, deadlineInternals, () => {
        httpClient
          .internal('downstream-deadline-header')
          .addBaseUrl(baseUrl)
          .get('/resource')
          .then(() => resolve())
          .catch(reject);
      });
    });

    expect(seenDeadline).toBe(String(deadlineAt));
  } finally {
    server.close();
  }
});

it('does not propagate x-request-deadline on external client by default', async () => {
  let seenDeadline: string | undefined;
  const { server, baseUrl } = await listen((req, res) => {
    seenDeadline = req.headers['x-request-deadline'] as string | undefined;
    res.statusCode = 200;
    res.end('{}');
  });

  try {
    const controller = new AbortController();
    const startedAt = Date.now();
    const store = {
      signal: controller.signal,
      startedAt,
      deadlineAt: startedAt + 5000,
    };

    await new Promise<void>((resolve, reject) => {
      DeadlineContext.run(store, deadlineInternals, () => {
        httpClient
          .external('external-no-deadline-header')
          .addBaseUrl(baseUrl)
          .get('/resource')
          .then(() => resolve())
          .catch(reject);
      });
    });

    expect(seenDeadline).toBeUndefined();
  } finally {
    server.close();
  }
});

it('propagates x-request-deadline on external client when opted in', async () => {
  let seenDeadline: string | undefined;
  const { server, baseUrl } = await listen((req, res) => {
    seenDeadline = req.headers['x-request-deadline'] as string | undefined;
    res.statusCode = 200;
    res.end('{}');
  });

  try {
    const controller = new AbortController();
    const startedAt = Date.now();
    const deadlineAt = startedAt + 5000;
    const store = {
      signal: controller.signal,
      startedAt,
      deadlineAt,
    };

    await new Promise<void>((resolve, reject) => {
      DeadlineContext.run(store, deadlineInternals, () => {
        httpClient
          .external('external-deadline-header-opt-in')
          .addBaseUrl(baseUrl)
          .addDeadlinePropagation({ propagateHeader: true })
          .get('/resource')
          .then(() => resolve())
          .catch(reject);
      });
    });

    expect(seenDeadline).toBe(String(deadlineAt));
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- src/core/http-client/http-client.spec.ts -t 'x-request-deadline'`  
Expected: FAIL (`addDeadlinePropagation` missing and/or header undefined).

- [ ] **Step 3: Implement policy and runtime**

In `src/core/http-client/types/policy.types.ts`, add:

```typescript
export interface DeadlinePropagationPolicy {
  propagateHeader?: boolean;
}
```

Add to `ClientPolicySnapshot`:

```typescript
deadlinePropagation?: DeadlinePropagationPolicy;
```

In `src/core/http-client/configured-http-client.ts`, import `DeadlinePropagationPolicy` and add:

```typescript
addDeadlinePropagation(
  policy: DeadlinePropagationPolicy = {},
): ConfiguredHttpClient {
  return this.withPolicy({ deadlinePropagation: policy });
}
```

Create `src/core/http-client/resilience/outbound-deadline-header.ts`:

```typescript
export {
  resolveOutboundDeadlineHeaders,
  type ResolveOutboundDeadlineHeadersInput,
} from '../../request-deadline/helpers/outbound-deadline-header';
```

Add to `src/core/http-client/resilience/index.ts`:

```typescript
export * from './outbound-deadline-header';
```

In `src/core/http-client/runtime/client-runtime.ts`, add imports:

```typescript
import type { ClientKind } from '../types';
import { getDeadlineAt } from '../../request-deadline/helpers/request-deadline.helpers';
import { resolveOutboundDeadlineHeaders } from '../../request-deadline/helpers/outbound-deadline-header';

function defaultPropagateDeadlineHeader(kind: ClientKind): boolean {
  return kind === 'internal';
}
```

After the `deadlineMerge` block (where `request = withoutUndefined({ ...request, signal, timeoutMs })`), insert:

```typescript
const propagateHeader =
  this.policy.deadlinePropagation?.propagateHeader ??
  defaultPropagateDeadlineHeader(this.policy.identity.kind);
const deadlineHeaders = resolveOutboundDeadlineHeaders({
  propagate: propagateHeader,
  inboundDeadlineAt: getDeadlineAt(),
  existingHeaders: request.headers as Record<string, string | undefined>,
});
if (Object.keys(deadlineHeaders).length > 0) {
  request = {
    ...request,
    headers: {
      ...request.headers,
      ...deadlineHeaders,
    },
  };
}
```

- [ ] **Step 4: Run HttpClient tests to verify they pass**

Run: `pnpm test:unit -- src/core/http-client/http-client.spec.ts`  
Expected: PASS (including new cases).

Run: `pnpm test:unit -- src/core/request-deadline/helpers/outbound-deadline-header.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/http-client/types/policy.types.ts \
  src/core/http-client/configured-http-client.ts \
  src/core/http-client/resilience/outbound-deadline-header.ts \
  src/core/http-client/resilience/index.ts \
  src/core/http-client/runtime/client-runtime.ts \
  src/core/http-client/http-client.spec.ts
git commit -m "feat(http-client): propagate inbound x-request-deadline to downstreams"
```

---

### Task 3: Feature documentation

**Files:**

- Modify: `docs/features/http_client.feature.md`
- Modify: `docs/features/features.md`

- [ ] **Step 1: Update http_client.feature.md**

Under **Inbound deadline inheritance**, append:

```markdown
- For **`internal()`** clients (default), when ALS has `deadlineAt`, outbound requests include **`x-request-deadline: <deadlineAtMs>`** unless the per-request headers already set that header.
- **`external()`** clients do not send the header unless you call **`.addDeadlinePropagation({ propagateHeader: true })`**.
- Disable on an internal client with **`.addDeadlinePropagation({ propagateHeader: false })`**.
- Downstream services should treat the header as an absolute cutoff (same format as this app’s response header). Signal and timeout capping via `remainingMs()` remain unchanged.
```

- [ ] **Step 2: Update features.md**

Change the Request deadline row note from “downstream `x-request-deadline` not wired” to reference header propagation on internal HttpClient.

Change **Deadline propagation** checklist note from “optional `x-request-deadline` header to downstreams not wired” to **Done** with brief note: internal default + external opt-in.

- [ ] **Step 3: Commit**

```bash
git add docs/features/http_client.feature.md docs/features/features.md
git commit -m "docs(http-client): document outbound x-request-deadline propagation"
```

---

## Plan self-review (spec coverage)

| Spec requirement                           | Task   |
| ------------------------------------------ | ------ |
| `REQUEST_DEADLINE_HEADER` constant         | Task 1 |
| Pure resolver + unit tests                 | Task 1 |
| No override of caller header               | Task 1 |
| internal default on / external default off | Task 2 |
| `.addDeadlinePropagation()`                | Task 2 |
| Merge after inbound signal/timeout merge   | Task 2 |
| Integration tests                          | Task 2 |
| Feature docs                               | Task 3 |

No placeholders; types and method names consistent across tasks.

---

**Plan complete and saved to `intent/outbound-x-request-deadline-propagation/plan.md`. Design spec: `intent/outbound-x-request-deadline-propagation/spec.md`.**

Please review the spec and plan; say if you want changes before implementation.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — implement in this session with executing-plans checkpoints

Which approach do you want?
