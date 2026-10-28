# Multi-VM Redis Coordination (Rate Limit + Cache) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire **`RateLimiterModule`** and **`CacheModule`** so production multi-VM deployments use **shared Redis backends** by default, while local development keeps **memory** unless explicitly overridden.

**Architecture:** Add pure resolvers `resolveRateLimitStorage(env)` and `resolveCacheStorage(env)` (read `NODE_ENV`, `RATE_LIMIT_STORAGE`, `CACHE_STORAGE`). Switch **`AppModule`** from `forRoot({ storage: Memory })` to **`forRootAsync`** factories that inject `ConfigService`, call resolvers, and pass through existing demo rate-limit methods and guest cookie options. Redis connection behavior stays in existing `RateLimiterModule` / `CacheModule` backend factories (`lazyConnect`, log on connect failure, no boot block).

**Tech Stack:** NestJS 11, `ConfigModule`, existing `RateLimitStorage` / `CacheStorage` enums, ioredis (already used by modules), Jest (`pnpm exec jest … --watchman=false --testPathIgnorePatterns='.worktrees'`).

## Global Constraints

- **Runtime:** Node **22+**; package manager **pnpm**; tests via **`pnpm exec jest … --watchman=false --testPathIgnorePatterns='.worktrees'`**.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Multi-VM assumption:** Production runs **>1 target** behind ALB; rate limits and cache must not multiply per VM when Redis is shared.
- **Boot safety:** Redis connect failure must **not** prevent app start (preserve existing `lazyConnect` + `.catch` log in `rate-limiter.module.ts` / `cache.module.ts`).
- **Scope OUT:** Changing demo `global-ip` limit (10/min); enterprise tier tables; WAF; new Redis cluster for feature flags (separate module).
- **Branch workflow (user preference):** **`feat/resilience-task-0-redis-coordination`**, merge to **`master`** with `--no-ff` when complete.

---

## File map

| File | Responsibility |
| ---- | -------------- |
| `src/common/config/resolve-coordination-storage.ts` | Parse env → `RateLimitStorage` / `CacheStorage` |
| `src/common/config/tests/resolve-coordination-storage.spec.ts` | Resolver unit tests |
| `src/common/config/env.schema.ts` | `RATE_LIMIT_STORAGE`, `CACHE_STORAGE` optional keys |
| `src/common/config/index.ts` | Re-export resolvers if barrel exists; else import path directly |
| `src/app.module.ts` | `CacheModule.forRootAsync`, `RateLimiterModule.forRootAsync` |
| `.env.example` | Document storage env vars |
| `docs/features/features.md` | Multi-VM rate limit / cache note |

---

### Task 1: Storage resolvers (TDD)

**Files:**
- Create: `src/common/config/resolve-coordination-storage.ts`
- Create: `src/common/config/tests/resolve-coordination-storage.spec.ts`

**Interfaces:**
- **Produces:**
  - `resolveRateLimitStorage(config: { nodeEnv?: string; rateLimitStorage?: string }): RateLimitStorage`
  - `resolveCacheStorage(config: { nodeEnv?: string; cacheStorage?: string }): CacheStorage`
  - Rules:
    - Explicit `memory` / `redis` (case-insensitive) wins.
    - When env var **omitted**: `NODE_ENV === 'production'` → **Redis**; otherwise **Memory**.
    - Invalid value → throw `Error` with allowed values in message.

- [ ] **Step 1: Write failing tests**

```typescript
// resolve-coordination-storage.spec.ts
import { CacheStorage } from '@/core/cache';
import { RateLimitStorage } from '@/core/rate-limiter';
import {
  resolveCacheStorage,
  resolveRateLimitStorage,
} from '../resolve-coordination-storage';

describe('resolveRateLimitStorage', () => {
  it('defaults to Memory in non-production when unset', () => {
    expect(resolveRateLimitStorage({ nodeEnv: 'development' })).toBe(
      RateLimitStorage.Memory,
    );
  });

  it('defaults to Redis in production when unset', () => {
    expect(resolveRateLimitStorage({ nodeEnv: 'production' })).toBe(
      RateLimitStorage.Redis,
    );
  });

  it('honors explicit redis override in development', () => {
    expect(
      resolveRateLimitStorage({
        nodeEnv: 'development',
        rateLimitStorage: 'redis',
      }),
    ).toBe(RateLimitStorage.Redis);
  });

  it('honors explicit memory override in production', () => {
    expect(
      resolveRateLimitStorage({
        nodeEnv: 'production',
        rateLimitStorage: 'memory',
      }),
    ).toBe(RateLimitStorage.Memory);
  });

  it('rejects unknown storage', () => {
    expect(() =>
      resolveRateLimitStorage({ rateLimitStorage: 'dynamodb' }),
    ).toThrow(/memory|redis/i);
  });
});

describe('resolveCacheStorage', () => {
  it('defaults to Memory in test when unset', () => {
    expect(resolveCacheStorage({ nodeEnv: 'test' })).toBe(
      CacheStorage.Memory,
    );
  });

  it('defaults to Redis in production when unset', () => {
    expect(resolveCacheStorage({ nodeEnv: 'production' })).toBe(
      CacheStorage.Redis,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest src/common/config/tests/resolve-coordination-storage.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: FAIL — module not found

- [ ] **Step 3: Implement resolvers**

```typescript
// resolve-coordination-storage.ts
import { CacheStorage } from '../../core/cache';
import { RateLimitStorage } from '../../core/rate-limiter';

type StorageToken = 'memory' | 'redis';

function parseStorageToken(
  raw: string | undefined,
  label: string,
): StorageToken | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'memory':
      return 'memory';
    case 'redis':
      return 'redis';
    default:
      throw new Error(
        `${label} must be "memory" or "redis" (got "${raw}")`,
      );
  }
}

function defaultStorageForNodeEnv(nodeEnv: string | undefined): StorageToken {
  return nodeEnv === 'production' ? 'redis' : 'memory';
}

export function resolveRateLimitStorage(config: {
  nodeEnv?: string;
  rateLimitStorage?: string;
}): RateLimitStorage {
  const token =
    parseStorageToken(config.rateLimitStorage, 'RATE_LIMIT_STORAGE') ??
    defaultStorageForNodeEnv(config.nodeEnv);
  return token === 'redis' ? RateLimitStorage.Redis : RateLimitStorage.Memory;
}

export function resolveCacheStorage(config: {
  nodeEnv?: string;
  cacheStorage?: string;
}): CacheStorage {
  const token =
    parseStorageToken(config.cacheStorage, 'CACHE_STORAGE') ??
    defaultStorageForNodeEnv(config.nodeEnv);
  return token === 'redis' ? CacheStorage.Redis : CacheStorage.Memory;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec jest src/common/config/tests/resolve-coordination-storage.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/common/config/resolve-coordination-storage.ts \
  src/common/config/tests/resolve-coordination-storage.spec.ts
git commit -m "feat(config): resolve Redis vs memory for rate limit and cache (Task 0)"
```

---

### Task 2: Env schema and `.env.example`

**Files:**
- Modify: `src/common/config/env.schema.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add optional env keys** (after `TRUST_PROXY` block)

```typescript
  RATE_LIMIT_STORAGE: { required: false },
  CACHE_STORAGE: { required: false },
```

- [ ] **Step 2: Document in `.env.example`** (after `TRUST_PROXY` section)

```bash
# Multi-VM coordination (rate limit + cache backends)
# Omit in production → Redis. Development/test default → memory.
# Explicit override: memory | redis
# RATE_LIMIT_STORAGE=redis
# CACHE_STORAGE=redis
```

- [ ] **Step 3: Commit**

```bash
git add src/common/config/env.schema.ts .env.example
git commit -m "chore(env): RATE_LIMIT_STORAGE and CACHE_STORAGE (Task 0)"
```

---

### Task 3: Wire `AppModule` async factories

**Files:**
- Modify: `src/app.module.ts` (replace `CacheModule.forRoot` and `RateLimiterModule.forRoot` blocks ~lines 93–111)

**Interfaces:**
- **Consumes:** `resolveRateLimitStorage`, `resolveCacheStorage`, `ConfigService.get('NODE_ENV')`, `get('RATE_LIMIT_STORAGE')`, `get('CACHE_STORAGE')`

- [ ] **Step 1: Add imports**

```typescript
import {
  resolveCacheStorage,
  resolveRateLimitStorage,
} from './common/config/resolve-coordination-storage';
```

- [ ] **Step 2: Replace CacheModule registration**

```typescript
CacheModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    storage: resolveCacheStorage({
      nodeEnv: configService.get<string>('NODE_ENV'),
      cacheStorage: configService.get<string>('CACHE_STORAGE'),
    }),
  }),
}),
```

- [ ] **Step 3: Replace RateLimiterModule registration** (preserve existing `methods`, `algorithm`, `guestCookie`)

```typescript
RateLimiterModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    storage: resolveRateLimitStorage({
      nodeEnv: configService.get<string>('NODE_ENV'),
      rateLimitStorage: configService.get<string>('RATE_LIMIT_STORAGE'),
    }),
    algorithm: RateLimitAlgorithm.FixedWindowCounter,
    guestCookie: {
      secure: configService.get<string>('NODE_ENV') === 'production',
    },
    methods: [
      {
        name: 'global-ip',
        identifier: RateLimitIdentifier.Ip,
        duration: 60_000,
        limit: 10,
        cost: 1,
        keyScope: 'global',
      },
    ],
  }),
}),
```

- [ ] **Step 4: Run targeted tests**

Run: `pnpm exec jest src/core/rate-limiter src/common/config/tests/resolve-coordination-storage.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS (no regression in rate-limiter specs)

- [ ] **Step 5: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(app): Redis-backed rate limit and cache defaults in production (Task 0)"
```

---

### Task 4: Documentation and ledger

**Files:**
- Modify: `docs/features/features.md`
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Update features.md** — extend Rate limiting row Notes:

```markdown
| Rate limiting | **Done** | … existing … **Multi-VM:** set `RATE_LIMIT_STORAGE=redis` (production default when unset). Enterprise: prefer `@RateLimit` with `RateLimitIdentifier.UserId` over IP-only `global-ip`. |
```

Add under Design / cross-cutting (or Cache row if present):

```markdown
| Cache | **Done** | **Multi-VM:** `CACHE_STORAGE=redis` in production (default when unset); memory in dev/test. |
```

- [ ] **Step 2: Update progress ledger**

```markdown
Task 0: complete (production Redis defaults for rate limit + cache)
```

- [ ] **Step 3: Commit**

```bash
git add docs/features/features.md .superpowers/sdd/progress.md
git commit -m "docs: multi-VM Redis coordination for rate limit and cache (Task 0)"
```

---

## Self-review

| Superplan Task 0 requirement | Plan task |
| ---------------------------- | --------- |
| `forRootAsync` + production Redis | Task 3 |
| `RATE_LIMIT_STORAGE`, `CACHE_STORAGE` in env.schema | Task 2 |
| Enterprise tenant-first note in features.md | Task 4 |
| Two instances share counter (Redis backend exists) | Validated by resolver + existing `RedisRateLimitBackend`; optional follow-up integration test not required for MVP |
| Boot succeeds if Redis lazy-connect fails | Unchanged module backend factories |
| Tests | Task 1 |

**Placeholder scan:** None.

**Type consistency:** `resolveRateLimitStorage` → `RateLimitStorage`; `resolveCacheStorage` → `CacheStorage`.

---

## Execution handoff

**Plan saved to** `docs/superpowers/plans/2026-10-28-multi-vm-redis-coordination.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — same session with checkpoints.

**Which approach?**
