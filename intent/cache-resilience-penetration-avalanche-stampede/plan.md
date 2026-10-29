# Cache Resilience (Penetration, Avalanche, Stampede) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden `CacheService` so callers using `getOrSet` get negative caching (penetration), TTL jitter (avalanche), and cluster-wide loader coalescing (stampede) while preserving existing SWR + in-process single-flight behavior.

**Architecture:** Keep `CacheBackend` for data; add pure helpers (`applyTtlJitter`, Redis SET-NX loader lock) and an optional `CacheLoaderLock` port injected only for Redis storage. Extend the cache envelope with `absent: true` for negative entries. `getOrSet` accepts a third argument `CacheGetOrSetOptions` (TTL + negative-cache flags). Memory backend stays single-VM coalescing via `inFlight`; Redis adds distributed lock + poll-wait for losers.

**Tech Stack:** NestJS 11, ioredis, Jest (`pnpm exec jest`), existing `CacheModule` / `resolveCacheStorageFromConfig`.

## Global Constraints

- **Runtime:** Node **22+**; package manager **pnpm**; tests via **`pnpm exec jest … --watchman=false --testPathIgnorePatterns='.worktrees'`**.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Redis key prefixes:** Data keys stay **`cache:`** (default `DEFAULT_CACHE_KEY_PREFIX`); loader locks use **`cache:lock:`** — must not collide with `rl:` or `revoked_jti:`.
- **Multi-VM:** Distributed stampede protection applies only when **`CACHE_STORAGE=redis`** (production default via `resolveCacheStorage`).
- **Boot safety:** Preserve **`lazyConnect`** + connect-failure log in `cache.module.ts`; lock acquisition failure must not block app boot.
- **YAGNI:** No Bloom filters, no new feature-module consumers in this plan (only core cache + docs); callers opt into negative caching per `getOrSet` call.
- **Backward compatibility:** Existing `getOrSet(key, loader, ttl?)` call shape remains valid; jitter defaults to **off** (`ttlJitterRatio: 0`) until configured.

---

## Design summary (Option B)

| Failure mode    | Mechanism                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Penetration** | Optional `cacheNull: true` on `getOrSet`; stores envelope `{ absent: true }` with shorter `negativeTtl`                                                      |
| **Avalanche**   | Optional `ttlJitterRatio` on module options; jitter applied when writing entries in `set` / `loadAndSet`                                                     |
| **Stampede**    | Existing in-process `inFlight` + **Redis SET NX** loader lock when Redis backend; losers poll `get()` until hit or `loaderWaitMs` then fail-open single load |

---

## File map

| File                                                 | Responsibility                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `src/core/cache/ttl/apply-ttl-jitter.ts`             | Pure jitter on `CacheTtl`                                        |
| `src/core/cache/ttl/apply-ttl-jitter.spec.ts`        | Unit tests                                                       |
| `src/core/cache/lock/redis-loader-lock.ts`           | SET NX acquire + Lua release                                     |
| `src/core/cache/lock/redis-loader-lock.spec.ts`      | Mock Redis tests                                                 |
| `src/core/cache/lock/cache-loader-lock.interface.ts` | `CacheLoaderLock` port                                           |
| `src/core/cache/lock/redis-cache-loader-lock.ts`     | Adapter using `RedisCacheBackend` client                         |
| `src/core/cache/types/cache.types.ts`                | `absent` on entry/result; `CacheGetOrSetOptions`; module options |
| `src/core/cache/constants/cache.constants.ts`        | `CACHE_LOADER_LOCK` symbol; lock prefix constant                 |
| `src/core/cache/cache.service.ts`                    | Negative cache, jitter, distributed load path                    |
| `src/core/cache/cache.service.spec.ts`               | New behaviors (memory path)                                      |
| `src/core/cache/cache.module.ts`                     | Provide `CACHE_LOADER_LOCK` for Redis                            |
| `src/core/cache/backends/redis.backend.ts`           | Expose `getRedis()` for lock adapter (same connection)           |
| `src/core/cache/backends/redis.backend.spec.ts`      | Optional multi-client stampede test if Redis available           |
| `src/common/config/env.schema.ts`                    | Optional cache env keys                                          |
| `.env.example`                                       | Document new vars                                                |
| `docs/features/features.md`                          | Update cache row + detail section                                |

---

### Task 1: TTL jitter helper (TDD)

**Files:**

- Create: `src/core/cache/ttl/apply-ttl-jitter.ts`
- Create: `src/core/cache/ttl/apply-ttl-jitter.spec.ts`

**Interfaces:**

- **Produces:** `applyTtlJitter(base: CacheTtl, ratio: number, random?: () => number): CacheTtl`
  - When `ratio <= 0`, return `base` unchanged.
  - Add uniform random in `[0, ratio * softTtlMs]` to soft, same pattern for hard; round to integer ms.
  - Throw if result soft/hard not positive or soft > hard.

- [ ] **Step 1: Write failing tests**

```typescript
// apply-ttl-jitter.spec.ts
import { applyTtlJitter } from './apply-ttl-jitter';

describe('applyTtlJitter', () => {
  it('returns base TTL when ratio is 0', () => {
    const base = { softTtlMs: 1000, hardTtlMs: 2000 };
    expect(applyTtlJitter(base, 0, () => 1)).toEqual(base);
  });

  it('adds jitter bounded by ratio', () => {
    const base = { softTtlMs: 1000, hardTtlMs: 2000 };
    const out = applyTtlJitter(base, 0.1, () => 1); // always max fraction
    expect(out.softTtlMs).toBe(1100);
    expect(out.hardTtlMs).toBe(2200);
  });

  it('throws when jitter breaks soft <= hard', () => {
    expect(() =>
      applyTtlJitter({ softTtlMs: 100, hardTtlMs: 105 }, 0.5, () => 1),
    ).toThrow(/softTtlMs must be <= hardTtlMs/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest src/core/cache/ttl/apply-ttl-jitter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement helper**

```typescript
// apply-ttl-jitter.ts
import { CacheTtl } from '../types/cache.types';

export function applyTtlJitter(
  base: CacheTtl,
  ratio: number,
  random: () => number = Math.random,
): CacheTtl {
  if (ratio <= 0) {
    return base;
  }
  const softJitter = Math.floor(random() * ratio * base.softTtlMs);
  const hardJitter = Math.floor(random() * ratio * base.hardTtlMs);
  const softTtlMs = base.softTtlMs + softJitter;
  const hardTtlMs = base.hardTtlMs + hardJitter;
  if (softTtlMs <= 0 || hardTtlMs <= 0) {
    throw new Error('Cache TTL values must be > 0 after jitter');
  }
  if (softTtlMs > hardTtlMs) {
    throw new Error('softTtlMs must be <= hardTtlMs');
  }
  return { softTtlMs, hardTtlMs };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec jest src/core/cache/ttl/apply-ttl-jitter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/cache/ttl/apply-ttl-jitter.ts src/core/cache/ttl/apply-ttl-jitter.spec.ts
git commit -m "feat(cache): add TTL jitter helper for avalanche mitigation"
```

---

### Task 2: Envelope + types for negative cache entries

**Files:**

- Modify: `src/core/cache/types/cache.types.ts`
- Modify: `src/core/cache/types/index.ts` (re-export new types)
- Modify: `src/core/cache/index.ts` (export `CacheGetOrSetOptions`)

**Interfaces:**

- **Produces:**
  - `CacheEntry<T>` adds optional `absent?: boolean` (when true, `v` is ignored)
  - `CacheGetResult<T> = { value: T; status: CacheFreshness } | { absent: true; status: CacheFreshness }`
  - `CacheGetOrSetOptions`: `{ ttl?: CacheTtl; cacheNull?: boolean; negativeTtl?: CacheTtl }`
  - `CacheModuleOptions` adds: `ttlJitterRatio?: number`; `loaderLockTtlMs?: number`; `loaderWaitMs?: number`; `defaultNegativeSoftTtlMs?`; `defaultNegativeHardTtlMs?`

- [ ] **Step 1: Update types**

```typescript
// cache.types.ts (additions)
export interface CacheGetOrSetOptions {
  ttl?: CacheTtl;
  /** When true, persist loader `null` as a negative entry. */
  cacheNull?: boolean;
  negativeTtl?: CacheTtl;
}

export interface CacheEntry<T = unknown> {
  v: T;
  softExpiresAt: number;
  hardExpiresAt: number;
  absent?: boolean;
}

export type CacheGetResult<T> =
  | { value: T; status: CacheFreshness }
  | { absent: true; status: CacheFreshness };

export interface CacheModuleOptions {
  storage?: CacheStorage;
  keyPrefix?: string;
  defaultSoftTtlMs?: number;
  defaultHardTtlMs?: number;
  /** 0–1 fraction; 0 disables jitter. */
  ttlJitterRatio?: number;
  loaderLockTtlMs?: number;
  loaderWaitMs?: number;
  defaultNegativeSoftTtlMs?: number;
  defaultNegativeHardTtlMs?: number;
}
```

- [ ] **Step 2: Adjust `CacheService.get` for absent entries**

In `cache.service.ts`, after loading `entry`, if `entry.absent === true`, return `{ absent: true, status }` using the same fresh/stale logic as values (compare `now` to `softExpiresAt` / `hardExpiresAt`).

- [ ] **Step 3: Run existing cache unit tests**

Run: `pnpm exec jest src/core/cache/cache.service.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS (no behavior change yet for callers)

- [ ] **Step 4: Commit**

```bash
git add src/core/cache/types/cache.types.ts src/core/cache/types/index.ts src/core/cache/index.ts src/core/cache/cache.service.ts
git commit -m "feat(cache): extend envelope and types for negative cache entries"
```

---

### Task 3: Negative caching + jitter in `getOrSet` (TDD)

**Files:**

- Modify: `src/core/cache/cache.service.ts`
- Modify: `src/core/cache/cache.service.spec.ts`

**Interfaces:**

- **Consumes:** `applyTtlJitter`, updated `CacheGetOrSetOptions`
- **Produces:** Overload-friendly signature:

```typescript
async getOrSet<T>(
  key: string,
  loader: () => Promise<T>,
  options?: CacheTtl | CacheGetOrSetOptions,
): Promise<T>
```

When third arg has `softTtlMs`/`hardTtlMs` only (legacy), treat as `{ ttl: thirdArg }`.

- [ ] **Step 1: Write failing tests for negative cache**

Add to `cache.service.spec.ts`:

```typescript
it('caches null when cacheNull is enabled (penetration)', async () => {
  const { service } = createService({
    defaultNegativeSoftTtlMs: 500,
    defaultNegativeHardTtlMs: 1000,
  });
  const loader = jest.fn(async () => null as string | null);
  const opts = {
    ttl: { softTtlMs: 5000, hardTtlMs: 10000 },
    cacheNull: true,
  };
  await expect(service.getOrSet('missing', loader, opts)).resolves.toBeNull();
  await expect(service.getOrSet('missing', loader, opts)).resolves.toBeNull();
  expect(loader).toHaveBeenCalledTimes(1);
  await expect(service.get('missing')).resolves.toEqual({
    absent: true,
    status: 'fresh',
  });
});

it('applies TTL jitter on set when module ratio > 0', async () => {
  const { service, backend } = createService({ ttlJitterRatio: 0.1 });
  await service.set('k', 1, { softTtlMs: 1000, hardTtlMs: 2000 });
  const entry = await backend.get('cache:k');
  expect(entry).not.toBeNull();
  const span = entry!.hardExpiresAt - entry!.softExpiresAt;
  expect(span).toBeGreaterThanOrEqual(1000);
  expect(span).toBeLessThanOrEqual(1200);
});
```

- [ ] **Step 2: Run tests (expect FAIL on new cases)**

Run: `pnpm exec jest src/core/cache/cache.service.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: FAIL on new tests

- [ ] **Step 3: Implement `getOrSet` options + negative write path**

Implementation notes (minimal):

1. Normalize third argument to `CacheGetOrSetOptions`.
2. In `resolveTtlForWrite(ttl)`, call `applyTtlJitter(resolved, this.options.ttlJitterRatio ?? 0)`.
3. On cache hit with `absent: true`, return `null` without loader (for `cacheNull` calls); if caller did not enable `cacheNull`, treat absent as miss (call loader) — **only write absent when `cacheNull: true`**.
4. After loader resolves, if `value === null && options.cacheNull`, `setNegative(key, negativeTtl)` writing `{ absent: true, v: null as T, softExpiresAt, hardExpiresAt }`.
5. Resolve negative TTL from `options.negativeTtl` or module defaults; throw clear error if `cacheNull` without resolvable negative TTL.

- [ ] **Step 4: Run tests**

Run: `pnpm exec jest src/core/cache/cache.service.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/cache/cache.service.ts src/core/cache/cache.service.spec.ts
git commit -m "feat(cache): negative caching and TTL jitter on getOrSet"
```

---

### Task 4: Redis loader lock primitives (TDD)

**Files:**

- Create: `src/core/cache/lock/cache-loader-lock.interface.ts`
- Create: `src/core/cache/lock/redis-loader-lock.ts`
- Create: `src/core/cache/lock/redis-loader-lock.spec.ts`

**Interfaces:**

- **Produces:**

```typescript
// cache-loader-lock.interface.ts
export interface CacheLoaderLock {
  tryAcquire(lockKey: string, ttlMs: number): Promise<string | null>;
  release(lockKey: string, token: string): Promise<void>;
}

// redis-loader-lock.ts
export async function acquireRedisLoaderLock(
  redis: Pick<Redis, 'set'>,
  lockKey: string,
  token: string,
  ttlMs: number,
): Promise<boolean>;

export async function releaseRedisLoaderLock(
  redis: Pick<Redis, 'eval'>,
  lockKey: string,
  token: string,
): Promise<void>;
```

Use `SET lockKey token NX PX ttlMs`. Release via Lua: delete only if value matches token.

- [ ] **Step 1: Write failing tests (mock Redis)**

```typescript
// redis-loader-lock.spec.ts
import {
  acquireRedisLoaderLock,
  releaseRedisLoaderLock,
} from './redis-loader-lock';

it('acquire succeeds only once for same key', async () => {
  const store = new Map<string, string>();
  const redis = {
    set: jest.fn(
      async (
        key: string,
        val: string,
        nx: string,
        _px: string,
        ttl: number,
      ) => {
        if (nx === 'NX' && store.has(key)) return null;
        store.set(key, val);
        return 'OK';
      },
    ),
    eval: jest.fn(async () => 1),
  };
  expect(
    await acquireRedisLoaderLock(redis as never, 'cache:lock:k', 't1', 5000),
  ).toBe(true);
  expect(
    await acquireRedisLoaderLock(redis as never, 'cache:lock:k', 't2', 5000),
  ).toBe(false);
});
```

- [ ] **Step 2: Run tests (FAIL)**

Run: `pnpm exec jest src/core/cache/lock/redis-loader-lock.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

- [ ] **Step 3: Implement acquire/release**

- [ ] **Step 4: Run tests (PASS)**

- [ ] **Step 5: Commit**

```bash
git add src/core/cache/lock/
git commit -m "feat(cache): Redis SET-NX loader lock helpers"
```

---

### Task 5: Wire `CacheLoaderLock` in module + expose Redis client

**Files:**

- Modify: `src/core/cache/backends/redis.backend.ts`
- Create: `src/core/cache/lock/redis-cache-loader-lock.ts`
- Modify: `src/core/cache/constants/cache.constants.ts`
- Modify: `src/core/cache/cache.module.ts`

**Interfaces:**

- **Produces:** `CACHE_LOADER_LOCK` symbol; provider returns `RedisCacheLoaderLock` when backend is `RedisCacheBackend`, else `undefined` (use `@Optional()` in `CacheService`).

- [ ] **Step 1: Add `getRedis(): Redis` to `RedisCacheBackend`**

```typescript
getRedis(): Redis {
  return this.redis;
}
```

- [ ] **Step 2: Implement adapter**

```typescript
// redis-cache-loader-lock.ts
export class RedisCacheLoaderLock implements CacheLoaderLock {
  constructor(private readonly redis: Redis) {}
  async tryAcquire(lockKey: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const ok = await acquireRedisLoaderLock(this.redis, lockKey, token, ttlMs);
    return ok ? token : null;
  }
  async release(lockKey: string, token: string): Promise<void> {
    await releaseRedisLoaderLock(this.redis, lockKey, token);
  }
}
```

- [ ] **Step 3: Register provider in `cache.module.ts`**

```typescript
{
  provide: CACHE_LOADER_LOCK,
  useFactory: (backend: CacheBackend) => {
    if (backend instanceof RedisCacheBackend) {
      return new RedisCacheLoaderLock(backend.getRedis());
    }
    return undefined;
  },
  inject: [CACHE_BACKEND],
},
```

- [ ] **Step 4: Inject optional lock into `CacheService` constructor**

- [ ] **Step 5: Run unit tests**

Run: `pnpm exec jest src/core/cache --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/cache/backends/redis.backend.ts src/core/cache/lock/redis-cache-loader-lock.ts src/core/cache/constants/cache.constants.ts src/core/cache/cache.module.ts src/core/cache/cache.service.ts
git commit -m "feat(cache): inject Redis loader lock for multi-VM stampede protection"
```

---

### Task 6: Distributed load coalescing in `loadAndSet`

**Files:**

- Modify: `src/core/cache/cache.service.ts`
- Create: `src/core/cache/cache.service.distributed.spec.ts` (mock lock + backend, no real Redis)

**Interfaces:**

- **Consumes:** `CacheLoaderLock`, `DEFAULT_CACHE_KEY_PREFIX`, lock prefix `cache:lock:` (constant `CACHE_LOADER_LOCK_PREFIX = 'cache:lock:'`)

**Behavior:**

1. Keep existing in-process `inFlight` map as first layer.
2. Before calling loader, if `this.loaderLock` defined:
   - `lockKey = CACHE_LOADER_LOCK_PREFIX + userKey` (no double `cache:` — use raw user key segment only once; e.g. user key `user:1` → `cache:lock:user:1`)
   - `token = await tryAcquire(lockKey, loaderLockTtlMs)`
   - If no token: `waitForPeer(key, deadline)` loop — sleep 25ms, `get(key)`, return on fresh/stale value or absent; if deadline exceeded, **fail-open** and run loader (log debug).
   - If token: re-check `get(key)`; then run loader; `set`; `finally release`.
3. Defaults: `loaderLockTtlMs = 30_000`, `loaderWaitMs = 5_000` from module options.

- [ ] **Step 1: Write failing test with fake lock**

```typescript
// cache.service.distributed.spec.ts
class FakeLock implements CacheLoaderLock {
  private holder: string | null = null;
  async tryAcquire(lockKey: string, _ttlMs: number): Promise<string | null> {
    if (this.holder) return null;
    this.holder = lockKey;
    return 'tok';
  }
  async release(lockKey: string, _token: string): Promise<void> {
    if (this.holder === lockKey) this.holder = null;
  }
}

it('runs loader once when second caller waits for peer fill', async () => {
  const backend = new MemoryCacheBackend();
  const lock = new FakeLock();
  const service = new CacheService(backend, { keyPrefix: 'cache:' }, lock as never);
  // simulate: first acquires lock, second waits and hits cache after first sets
  ...
});
```

(Implement test with delayed loader on first call and concurrent second `getOrSet`.)

- [ ] **Step 2: Implement wait + lock path in `loadAndSet`**

- [ ] **Step 3: Run tests**

Run: `pnpm exec jest src/core/cache/cache.service.distributed.spec.ts src/core/cache/cache.service.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/cache/cache.service.ts src/core/cache/cache.service.distributed.spec.ts
git commit -m "feat(cache): distributed loader coalescing with poll-wait fallback"
```

---

### Task 7: Config + env documentation

**Files:**

- Modify: `src/common/config/env.schema.ts`
- Modify: `.env.example`
- Modify: `src/app.module.ts` (merge cache factory options from `ConfigService`)
- Create: `src/common/config/parse-cache-module-options.ts` (+ spec)

**Interfaces:**

- **Produces:** `parseCacheModuleOptions(configService: ConfigService): Partial<CacheModuleOptions>`

Env vars (all optional):

| Variable                     | Default  | Purpose                    |
| ---------------------------- | -------- | -------------------------- |
| `CACHE_TTL_JITTER_RATIO`     | `0`      | 0–1 jitter fraction        |
| `CACHE_LOADER_LOCK_TTL_MS`   | `30000`  | Redis lock TTL             |
| `CACHE_LOADER_WAIT_MS`       | `5000`   | Peer wait before fail-open |
| `CACHE_NEGATIVE_SOFT_TTL_MS` | `60000`  | Default negative soft TTL  |
| `CACHE_NEGATIVE_HARD_TTL_MS` | `300000` | Default negative hard TTL  |

- [ ] **Step 1: Write failing parser tests**

```typescript
// parse-cache-module-options.spec.ts
it('parses jitter ratio', () => {
  const cs = {
    get: (k: string) => (k === 'CACHE_TTL_JITTER_RATIO' ? '0.15' : undefined),
  };
  expect(parseCacheModuleOptions(cs as never).ttlJitterRatio).toBe(0.15);
});
```

- [ ] **Step 2: Implement parser + wire `AppModule`**

```typescript
CacheModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (...args: unknown[]) => ({
    storage: resolveCacheStorageFromConfig(configServiceFromFactoryArgs(args)),
    ...parseCacheModuleOptions(configServiceFromFactoryArgs(args)),
  }),
}),
```

- [ ] **Step 3: Update `.env.example` and `env.schema.ts`**

- [ ] **Step 4: Run tests**

Run: `pnpm exec jest src/common/config/parse-cache-module-options.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/common/config/parse-cache-module-options.ts src/common/config/parse-cache-module-options.spec.ts src/common/config/env.schema.ts .env.example src/app.module.ts
git commit -m "feat(config): cache resilience env options for jitter and loader lock"
```

---

### Task 8: Feature docs + optional Redis integration smoke

**Files:**

- Modify: `docs/features/features.md`

- [ ] **Step 1: Update feature matrix**

Change cache rows to document:

- Penetration: **Partial** — opt-in `cacheNull` on `getOrSet`
- Avalanche: **Partial** — TTL jitter via `CACHE_TTL_JITTER_RATIO`
- Stampede: **Done** (core) — SWR + in-flight + Redis lock when `CACHE_STORAGE=redis`; feature modules still opt-in by using `CacheService`

- [ ] **Step 2: Add usage snippet in cache section**

```typescript
await cacheService.getOrSet(`user:${id}`, () => repo.findById(id), {
  ttl: { softTtlMs: 60_000, hardTtlMs: 300_000 },
  cacheNull: true,
  negativeTtl: { softTtlMs: 30_000, hardTtlMs: 60_000 },
});
```

- [ ] **Step 3: Run full cache test suite**

Run: `pnpm exec jest src/core/cache --watchman=false --testPathIgnorePatterns='.worktrees'`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/features/features.md
git commit -m "docs: cache penetration, avalanche, and stampede mitigation"
```

---

## Plan self-review

**Spec coverage:** Penetration (Task 2–3), avalanche (Task 1–3–7), stampede multi-VM (Task 4–6), config/docs (Task 7–8). Bloom filters and automatic feature-module adoption explicitly out of scope.

**Placeholder scan:** No TBD steps; commands and signatures included.

**Type consistency:** `CacheGetOrSetOptions` and `CacheLoaderLock` names used consistently across tasks; legacy `CacheTtl` third argument preserved via normalization in Task 3.

---

## Execution handoff

Plan complete and saved to `intent/cache-resilience-penetration-avalanche-stampede/plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
