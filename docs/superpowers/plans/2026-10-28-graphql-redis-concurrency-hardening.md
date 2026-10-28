# GraphQL Redis Concurrency Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden `ComplexityPlugin` Redis per-subject GraphQL concurrency for **multi-VM** deployments: leak-safe TTL keys, stable subject identity (user or guest), **503 + Retry-After** on overload, and single-release semantics (no double `decr`).

**Architecture:** Extract pure helpers in `src/common/plugins/graphql-concurrency/` for subject resolution, Redis acquire/release (incr + EXPIRE + guarded decr), and overload HTTP metadata. `ComplexityPlugin` orchestrates helpers; reuse `GuestIdMiddleware.readValidGuestId` for anonymous clients and `resolveOverloadRetryAfterSec()` from `src/core/overload` for `Retry-After`. GraphQL HTTP status is set on the Fastify `reply` from context when concurrency is denied.

**Tech Stack:** NestJS 11, Apollo Server 5, `@nestjs/graphql`, ioredis via `RedisService`, Jest (`pnpm exec jest`), Fastify request cookies (`guest_id`).

## Global Constraints

- **Runtime:** Node **22+**; package manager **pnpm**; tests via **`pnpm exec jest … --watchman=false --testPathIgnorePatterns='.worktrees'`**.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Multi-VM:** Concurrency cap is **cluster-wide** only because Redis is shared; document **`GQL_MAX_CONCURRENCY`** as **per subject across all tasks**, not per VM.
- **HTTP overload semantics:** Concurrency denial → **503** + **`Retry-After`** (seconds); extension code stays **`TOO_MANY_CONCURRENT_REQUESTS`** (overload, not quota abuse).
- **Scope OUT:** Duplicate GraphQL rate limiter; federation; changing complexity/budget algorithm beyond concurrency hardening.
- **Branch workflow (user preference):** Implement on **`feat/resilience-task-5-graphql-concurrency`**, merge to **`master`** with `--no-ff` when complete.

---

## File map

| File | Responsibility |
| ---- | -------------- |
| `src/common/plugins/graphql-concurrency/graphql-concurrency.constants.ts` | Default TTL, extension codes |
| `src/common/plugins/graphql-concurrency/resolve-graphql-subject.ts` | Map `context.req` → Redis subject segment |
| `src/common/plugins/graphql-concurrency/redis-concurrency.ts` | `acquireRedisConcurrency` / `releaseRedisConcurrency` |
| `src/common/plugins/graphql-concurrency/index.ts` | Re-exports |
| `src/common/plugins/tests/graphql-concurrency.spec.ts` | Unit tests (pure + mocked Redis) |
| `src/common/plugins/complexity.plugin.ts` | Wire helpers; inject `GuestIdMiddleware` |
| `src/common/config/env.schema.ts` | `GQL_CONCURRENCY_KEY_TTL_SEC` |
| `.env.example` | Document GraphQL concurrency env vars |
| `docs/features/features.md` | GraphQL / backpressure notes |

---

### Task 1: Pure Redis concurrency helpers (TDD)

**Files:**
- Create: `src/common/plugins/graphql-concurrency/graphql-concurrency.constants.ts`
- Create: `src/common/plugins/graphql-concurrency/redis-concurrency.ts`
- Create: `src/common/plugins/tests/graphql-concurrency.spec.ts`
- Create: `src/common/plugins/graphql-concurrency/index.ts`

**Interfaces:**
- **Produces:**
  - `GQL_CONCURRENCY_KEY_PREFIX = 'gql:concurrency:'`
  - `DEFAULT_GQL_CONCURRENCY_KEY_TTL_SEC = 300`
  - `GRAPHQL_OVERLOAD_EXTENSION_CODE = 'TOO_MANY_CONCURRENT_REQUESTS' as const`
  - `acquireRedisConcurrency(redis, key, maxConcurrent, ttlSec): Promise<{ acquired: true; current: number } | { acquired: false; current: number }>`
  - `releaseRedisConcurrency(redis, key, state: { released: boolean }): Promise<void>` — sets `state.released = true` once; idempotent

- [ ] **Step 1: Write constants**

```typescript
// graphql-concurrency.constants.ts
export const GQL_CONCURRENCY_KEY_PREFIX = 'gql:concurrency:';
export const DEFAULT_GQL_CONCURRENCY_KEY_TTL_SEC = 300;
export const GRAPHQL_OVERLOAD_EXTENSION_CODE = 'TOO_MANY_CONCURRENT_REQUESTS';
```

- [ ] **Step 2: Write failing tests for acquire/release**

```typescript
// graphql-concurrency.spec.ts (excerpt)
import { acquireRedisConcurrency, releaseRedisConcurrency } from '../graphql-concurrency/redis-concurrency';

function createMockRedis() {
  let value = 0;
  return {
    incr: jest.fn(async (key: string) => {
      value += 1;
      return value;
    }),
    decr: jest.fn(async () => {
      value = Math.max(0, value - 1);
      return value;
    }),
    expire: jest.fn(async () => 1),
    getValue: () => value,
  };
}

it('acquire sets EXPIRE on every successful incr', async () => {
  const redis = createMockRedis();
  const r = await acquireRedisConcurrency(redis as never, 'gql:concurrency:guest:x', 3, 300);
  expect(r.acquired).toBe(true);
  expect(redis.expire).toHaveBeenCalledWith('gql:concurrency:guest:x', 300);
});

it('reject when over max without leaving counter elevated', async () => {
  const redis = createMockRedis();
  await acquireRedisConcurrency(redis as never, 'k', 1, 300);
  const r = await acquireRedisConcurrency(redis as never, 'k', 1, 300);
  expect(r.acquired).toBe(false);
  expect(redis.getValue()).toBe(1);
});

it('release decrements once even if called twice', async () => {
  const redis = createMockRedis();
  const state = { released: false };
  await acquireRedisConcurrency(redis as never, 'k', 2, 300);
  await releaseRedisConcurrency(redis as never, 'k', state);
  await releaseRedisConcurrency(redis as never, 'k', state);
  expect(redis.decr).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run tests (expect FAIL)**

Run: `pnpm exec jest src/common/plugins/tests/graphql-concurrency.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: FAIL — module not found

- [ ] **Step 4: Implement `redis-concurrency.ts`**

```typescript
import type Redis from 'ioredis';

export type ConcurrencyReleaseState = { released: boolean };

export async function acquireRedisConcurrency(
  redis: Redis,
  key: string,
  maxConcurrent: number,
  ttlSec: number,
): Promise<{ acquired: true; current: number } | { acquired: false; current: number }> {
  const current = await redis.incr(key);
  await redis.expire(key, ttlSec);
  if (current > maxConcurrent) {
    await redis.decr(key);
    return { acquired: false, current: current - 1 };
  }
  return { acquired: true, current };
}

export async function releaseRedisConcurrency(
  redis: Redis,
  key: string,
  state: ConcurrencyReleaseState,
): Promise<void> {
  if (state.released) {
    return;
  }
  state.released = true;
  await redis.decr(key);
}
```

- [ ] **Step 5: Run tests (expect PASS)**

Run: same jest command as Step 3

- [ ] **Step 6: Commit**

```bash
git checkout master && git checkout -b feat/resilience-task-5-graphql-concurrency
git add src/common/plugins/graphql-concurrency src/common/plugins/tests/graphql-concurrency.spec.ts
git commit -m "feat(graphql): add Redis concurrency acquire/release helpers"
```

---

### Task 2: Stable GraphQL subject key (user + guest)

**Files:**
- Create: `src/common/plugins/graphql-concurrency/resolve-graphql-subject.ts`
- Modify: `src/common/plugins/tests/graphql-concurrency.spec.ts` (add subject tests)

**Interfaces:**
- **Consumes:** `DEFAULT_GUEST_COOKIE_NAME`, `GUEST_ID_UUID_V4_RE` from `src/core/rate-limiter/constants/rate-limit.constants.ts` (or call `GuestIdMiddleware.readValidGuestId` from plugin only — helpers stay pure with injected guest id string).
- **Produces:** `resolveGraphqlSubject(input: { userId?: string; guestId?: string | null }): { redisKey: string; label: string }`
  - Authenticated: `redisKey = gql:concurrency:user:<userId>`
  - Guest: `redisKey = gql:concurrency:guest:<uuid>`
  - Fallback (no user, invalid/missing guest): `redisKey = gql:concurrency:anon:shared` and `label = 'anonymous'`

- [ ] **Step 1: Write failing subject tests**

```typescript
import { resolveGraphqlSubject } from '../graphql-concurrency/resolve-graphql-subject';

it('uses user id when authenticated', () => {
  expect(resolveGraphqlSubject({ userId: 'u-1', guestId: null }).redisKey).toBe(
    'gql:concurrency:user:u-1',
  );
});

it('uses guest id when unauthenticated', () => {
  const guest = '550e8400-e29b-41d4-a716-446655440000';
  expect(resolveGraphqlSubject({ guestId: guest }).redisKey).toBe(
    `gql:concurrency:guest:${guest}`,
  );
});

it('falls back to shared anon bucket', () => {
  expect(resolveGraphqlSubject({}).redisKey).toBe('gql:concurrency:anon:shared');
});
```

- [ ] **Step 2: Implement `resolve-graphql-subject.ts`**

```typescript
import { GQL_CONCURRENCY_KEY_PREFIX } from './graphql-concurrency.constants';

export function resolveGraphqlSubject(input: {
  userId?: string;
  guestId?: string | null;
}): { redisKey: string; label: string } {
  if (input.userId) {
    return {
      redisKey: `${GQL_CONCURRENCY_KEY_PREFIX}user:${input.userId}`,
      label: input.userId,
    };
  }
  if (input.guestId) {
    return {
      redisKey: `${GQL_CONCURRENCY_KEY_PREFIX}guest:${input.guestId}`,
      label: input.guestId,
    };
  }
  return {
    redisKey: `${GQL_CONCURRENCY_KEY_PREFIX}anon:shared`,
    label: 'anonymous',
  };
}
```

- [ ] **Step 3: Run subject tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/common/plugins/graphql-concurrency/resolve-graphql-subject.ts src/common/plugins/tests/graphql-concurrency.spec.ts
git commit -m "feat(graphql): resolve concurrency Redis key per user or guest"
```

---

### Task 3: Refactor `ComplexityPlugin` (TTL, single release, guest cookie)

**Files:**
- Modify: `src/common/plugins/complexity.plugin.ts`
- Modify: `src/app.module.ts` (only if `ComplexityPlugin` needs `RateLimiterModule` import — already global via `GuestIdMiddleware` export)

**Interfaces:**
- **Consumes:** `GuestIdMiddleware.readValidGuestId`, `DEFAULT_GUEST_COOKIE_NAME`, helpers from Task 1–2, `ConfigService` for `GQL_MAX_CONCURRENCY`, `GQL_CONCURRENCY_KEY_TTL_SEC`.

- [ ] **Step 1: Inject `GuestIdMiddleware` into `ComplexityPlugin` constructor**

```typescript
constructor(
  private configService: ConfigService,
  private redisService: RedisService,
  private guestIdMiddleware: GuestIdMiddleware,
) {
  // existing numeric config +:
  this.concurrencyKeyTtlSec = parsePositiveInt(
    this.configService.get('GQL_CONCURRENCY_KEY_TTL_SEC'),
    DEFAULT_GQL_CONCURRENCY_KEY_TTL_SEC,
  );
}
```

Add private helper `parsePositiveInt` in plugin file or reuse existing parse from overload pattern.

- [ ] **Step 2: Replace inline incr/decr block in `requestDidStart`**

```typescript
const req = contextValue.req;
const guestId = req
  ? this.guestIdMiddleware.readValidGuestId(req, DEFAULT_GUEST_COOKIE_NAME)
  : null;
const { redisKey, label } = resolveGraphqlSubject({
  userId: req?.user?.id,
  guestId,
});

const releaseState = { released: false };
const acquired = await acquireRedisConcurrency(
  redis,
  redisKey,
  this.maxConcurrency,
  this.concurrencyKeyTtlSec,
);
if (!acquired.acquired) {
  throw buildConcurrencyOverloadError(label); // Task 4
}

return {
  async didResolveOperation(...) { /* unchanged budget logic uses same label/redisKey variable */ },
  async willSendResponse() {
    await releaseRedisConcurrency(redis, redisKey, releaseState);
  },
  async didEncounterErrors() {
    await releaseRedisConcurrency(redis, redisKey, releaseState);
  },
};
```

Remove old `concurrencyKey = gql:concurrency:${userId}` and remove **inline decr before throw** (handled inside `acquireRedisConcurrency`).

- [ ] **Step 3: Align budget key with subject (optional but recommended in same task)**

Change `budgetKey` from `gql:budget:${userId}` to `gql:budget:${label}` or derive from same subject helper (`redisKey.replace('concurrency', 'budget')`) so guest users get per-guest budgets. Document in commit message.

- [ ] **Step 4: Manual smoke (local)**

Run: `pnpm start:dev` (with Redis up), two parallel GraphQL requests as same guest — second should fail when `GQL_MAX_CONCURRENCY=1`.

- [ ] **Step 5: Commit**

```bash
git add src/common/plugins/complexity.plugin.ts
git commit -m "feat(graphql): harden Redis concurrency with TTL and guest subject keys"
```

---

### Task 4: HTTP 503 + Retry-After on concurrency denial

**Files:**
- Create: `src/common/plugins/graphql-concurrency/build-concurrency-overload-error.ts`
- Modify: `src/common/plugins/complexity.plugin.ts`
- Modify: `src/common/plugins/tests/graphql-concurrency.spec.ts`

**Interfaces:**
- **Consumes:** `resolveOverloadRetryAfterSec()` from `src/core/overload/resolve-overload-retry-after-sec.ts`, `GRAPHQL_OVERLOAD_EXTENSION_CODE`.
- **Produces:** `buildConcurrencyOverloadError(label: string): GraphQLError`, `applyGraphqlOverloadHttpHeaders(reply, retryAfterSec): void`

- [ ] **Step 1: Write helper**

```typescript
import { GraphQLError } from 'graphql';
import { GRAPHQL_OVERLOAD_EXTENSION_CODE } from './graphql-concurrency.constants';

export function buildConcurrencyOverloadError(subjectLabel: string): GraphQLError {
  return new GraphQLError(
    `Too many concurrent queries for subject ${subjectLabel}`,
    {
      extensions: {
        code: GRAPHQL_OVERLOAD_EXTENSION_CODE,
        http: { status: 503 },
      },
    },
  );
}

export function applyGraphqlOverloadHttpHeaders(
  reply: { header?: (n: string, v: string) => void } | undefined,
  retryAfterSec: number,
): void {
  reply?.header?.('Retry-After', String(retryAfterSec));
  reply?.header?.('Cache-Control', 'no-store');
}
```

- [ ] **Step 2: In `ComplexityPlugin`, on deny — set headers before throw**

```typescript
import { resolveOverloadRetryAfterSec } from '@/core/overload/resolve-overload-retry-after-sec';

// inside requestDidStart, when !acquired.acquired:
const retryAfterSec = resolveOverloadRetryAfterSec();
applyGraphqlOverloadHttpHeaders(contextValue.res, retryAfterSec);
throw buildConcurrencyOverloadError(label);
```

Ensure GraphQL context typing includes `res?: FastifyReply`:

```typescript
const contextValue = requestContext.contextValue as {
  req?: FastifyRequest & { user?: { id?: string }; cookies?: Record<string, string> };
  res?: { header?: (name: string, value: string) => void };
};
```

- [ ] **Step 3: Test error shape**

```typescript
it('buildConcurrencyOverloadError uses 503 extension', () => {
  const err = buildConcurrencyOverloadError('guest-1');
  expect(err.extensions?.code).toBe('TOO_MANY_CONCURRENT_REQUESTS');
  expect(err.extensions?.http).toEqual({ status: 503 });
});
```

- [ ] **Step 4: Commit**

```bash
git add src/common/plugins/graphql-concurrency/build-concurrency-overload-error.ts src/common/plugins/complexity.plugin.ts src/common/plugins/tests/graphql-concurrency.spec.ts
git commit -m "feat(graphql): return 503 and Retry-After on concurrency overload"
```

---

### Task 5: Env, docs, verification, merge

**Files:**
- Modify: `src/common/config/env.schema.ts`
- Modify: `.env.example`
- Modify: `docs/features/features.md` (GraphQL row + multi-VM note)

- [ ] **Step 1: Add env schema entry**

```typescript
GQL_CONCURRENCY_KEY_TTL_SEC: { required: false },
```

- [ ] **Step 2: Document in `.env.example`**

```env
# GraphQL (shared Redis across ECS tasks — limits are cluster-wide per user/guest)
GQL_MAX_CONCURRENCY=3
GQL_CONCURRENCY_KEY_TTL_SEC=300
```

Add comment: enterprise clients behind NAT share **`anon:shared`** if neither JWT nor `guest_id` cookie; prefer authenticated or guest cookie for fair limits.

- [ ] **Step 3: Update features.md GraphQL / backpressure bullets**

Note: Redis concurrency TTL leak fix; per-guest keys; 503 overload.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm exec jest src/common/plugins/tests/graphql-concurrency.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'
pnpm exec jest src/core/overload/tests --watchman=false --testPathIgnorePatterns='.worktrees'
```

Expected: all PASS

- [ ] **Step 5: Merge to master**

```bash
git add src/common/config/env.schema.ts .env.example docs/features/features.md
git commit -m "docs(graphql): document cluster-wide concurrency env vars"
git checkout master
git merge --no-ff feat/resilience-task-5-graphql-concurrency -m "Merge branch 'feat/resilience-task-5-graphql-concurrency'

Task 5: GraphQL Redis concurrency hardening for multi-VM."
```

---

## Self-review (spec coverage)

| Superplan requirement | Task |
| --------------------- | ---- |
| EXPIRE on concurrency keys | Task 1 `acquireRedisConcurrency` |
| Guest vs anonymous subject | Task 2–3 |
| 503 + Retry-After on deny | Task 4 |
| `GQL_CONCURRENCY_KEY_TTL_SEC` | Task 5 |
| No double decr | Task 1 `releaseRedisConcurrency` + Task 3 hooks |
| Jest with mocked Redis | Task 1 |
| Cluster-wide cap documentation | Task 5 |

**Placeholder scan:** None.

**Note on Task 0:** Redis rate-limit storage defaults remain a separate superplan task; GraphQL concurrency **already uses Redis** via `RedisService` — no blocker for Task 5.

---

## Execution handoff

**Plan saved to:** `docs/superpowers/plans/2026-10-28-graphql-redis-concurrency-hardening.md`

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — same session with `executing-plans`, checkpoints after each task  

**Which approach?**
