# NestJS v12 Phase 1 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade this boilerplate from NestJS 11 to NestJS 12 (Phase 1) with all `@nestjs/*` packages aligned, TypeScript 6, GraphQL and Terminus breaking changes fixed, and **no intentional behavior change** to HTTP, GraphQL, WebSockets, jobs, auth, or health semantics.

**Architecture:** Use official `nest upgrade` to bump recognized Nest packages and apply mechanical migrations, then fix repo-specific breakages (Terminus custom indicator, GraphQL IDE config, Jest/ESM if needed). Keep **CommonJS** (`tsconfig.json` `module: commonjs`), **class-validator** + global `ValidationPipe`, **custom `validateEnv`** (no Joi/Zod migration), and **Fastify AJV** settings in `main.ts`. Defer Vitest, ESM app layout, Standard Schema, and `@nestjs/observe`.

**Tech Stack:** NestJS 12, Fastify 5, GraphQL 16 + `@nestjs/graphql` 14, BullMQ 6, Jest 30 + ts-jest, TypeScript 6, pnpm 10.

## Global Constraints

- **Runtime (app):** Node **≥20.19** or **≥22.12** (Nest 12 ESM packages via `require(esm)`); **Jest with v12:** Node **≥24.9** per [Nest migration guide](https://docs.nestjs.com/migration-guide).
- **Runtime (CI / dev / tests):** Pin **Node ≥24.9** (e.g. `24.18`) in `.nvmrc` and document in README; Docker image must use **node:22.12+** or **node:24-alpine** (not plain `node:22-alpine` on an old 22.0 patch).
- **Package manager:** **pnpm** only; use `pnpm exec nest upgrade`, not npm-only flows that skip the lockfile.
- **Validation:** Do **not** add Zod, Valibot, or `StandardSchemaValidationPipe`. Keep `SanitizationPipe` → `ValidationPipe` → class-validator DTOs.
- **Config:** Keep `ConfigModule.forRoot({ validate: validateEnv })` in `src/app.module.ts`; do **not** introduce Joi `validationSchema`.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for enums/unions.
- **Tests:** `pnpm test:unit`, `pnpm test:integration`, `pnpm run build`, `pnpm run lint`, `pnpm run smoke:shutdown` must pass before the upgrade is done.
- **Health probes:** Feature flags health remains **informational only** (must not fail readiness when Redis is down).

---

## Section 2 — Architecture & package strategy

### Upgrade unit (single PR / branch)

All Nest-owned packages move together so peers stay satisfied. `@nestjs/bullmq` is already on major 12; everything else on 11 (or `@nestjs/config` 4) catches up.

| Package                                                | Current (approx.) | Target after Phase 1                                        |
| ------------------------------------------------------ | ----------------- | ----------------------------------------------------------- |
| `@nestjs/common`, `@nestjs/core`                       | 11.1.17           | **12.3.x** (same patch across core packages)                |
| `@nestjs/platform-fastify`                             | 11.1.17           | **12.3.x**                                                  |
| `@nestjs/microservices`                                | 11.1.17           | **12.3.x**                                                  |
| `@nestjs/platform-socket.io`, `@nestjs/websockets`     | 11.1.17           | **12.3.x**                                                  |
| `@nestjs/config`                                       | ^4.0.3            | **^12.0.1**                                                 |
| `@nestjs/terminus`                                     | ^11.0.0           | **^12.1.0**                                                 |
| `@nestjs/mongoose`                                     | ^11.0.4           | **^12.0.0**                                                 |
| `@nestjs/jwt`                                          | ^11.0.2           | **^12.0.3**                                                 |
| `@nestjs/passport`                                     | ^11.0.5           | **^12.0.0**                                                 |
| `@nestjs/graphql`, `@nestjs/apollo`                    | ^13.2.4           | **^14.1.x** (requires `@nestjs/core` ^12)                   |
| `@nestjs/bullmq`                                       | ^12.0.0           | **^12.x** (re-resolve with lockfile)                        |
| `@nestjs/throttler`                                    | ^6.5.0            | **^6.7.x** (optional minor bump if `nest upgrade` does not) |
| `@nestjs/cli`, `@nestjs/schematics`, `@nestjs/testing` | 11.x              | **12.x**                                                    |
| `typescript`                                           | 5.9.3             | **^6.0.0** (required by `@nestjs/schematics` v12)           |

**Unchanged third-party:** `class-validator`, `class-transformer`, `fastify`, `@apollo/server`, `bullmq`, `mongoose`, OpenTelemetry stack in `src/instrumentation.ts`.

### Mechanical vs manual work

| Area                        | Owner          | Action                                                                                                                         |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Version bumps + TS6         | `nest upgrade` | Run after local CLI 12 install                                                                                                 |
| GraphQL `playground`        | Manual         | `src/app.module.ts` → `graphiql: true` (or options object)                                                                     |
| Custom Terminus indicator   | Manual         | `src/feature-flag/feature-flag.health.ts` → `HealthIndicatorService` API                                                       |
| Config validation           | None           | Custom `validateEnv` unchanged                                                                                                 |
| Lifecycle hook order        | Verify only    | Re-run unit/integration; no code change unless tests prove order bug                                                           |
| `@Optional()` on subclasses | Audit          | Grep `@Optional()` — redeclare on subclass constructors if any extend injected base                                            |
| pnpm overrides              | Manual cleanup | Remove `@nestjs/core@<=11.1.17`, `@nestjs/microservices@<=11.1.18`, `@nestjs/platform-fastify@<=11.1.23` overrides once on v12 |
| Jest + ESM Nest packages    | Conditional    | Fix only if tests fail with `ERR_REQUIRE_ASYNC_MODULE` on Node ≥24.9                                                           |

### Risk surfaces in this repo

1. **`FeatureFlagHealthIndicator`** — extends removed `HealthIndicator` / throws `HealthCheckError` (Terminus v12).
2. **`GraphQLModule`** — `playground: true` removed in favor of GraphiQL.
3. **`MicroserviceHealthIndicator.pingCheck`** — `timeout` option deprecated in Terminus v12; fix compile/API warnings after upgrade.
4. **Jest** — ESM-only `@nestjs/*` v12; mitigated by Node 24.9+ and possibly `transformIgnorePatterns`.
5. **Docker** — `node:22-alpine` must be ≥22.12 for production `require(esm)`.

---

## File map

| Responsibility                     | Create                                         | Modify                                    |
| ---------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| Node version pin                   | `.nvmrc`                                       | `README.md`, `Dockerfile`                 |
| Dependencies                       | —                                              | `package.json`, `pnpm-lock.yaml`          |
| GraphQL IDE                        | —                                              | `src/app.module.ts`                       |
| Terminus v12 indicator             | `src/feature-flag/feature-flag.health.spec.ts` | `src/feature-flag/feature-flag.health.ts` |
| Health Redis ping (if types break) | —                                              | `src/health/health.controller.ts`         |
| Jest ESM (if needed)               | —                                              | `jest.config.ts`                          |
| Overrides cleanup                  | —                                              | `package.json` (`pnpm.overrides`)         |
| Upgrade notes                      | `docs/operations/nestjs-12-upgrade.md`         | —                                         |

---

### Task 0: Pre-upgrade baseline & Node pin

**Files:**

- Create: `.nvmrc`
- Modify: `README.md` (Runtime section)

**Interfaces:**

- Produces: documented Node floor and a green baseline command log (saved in PR description or upgrade doc).

- [ ] **Step 1: Pin Node for developers and CI**

Create `.nvmrc`:

```text
24.18.0
```

Add to `README.md` after Installation (new subsection **Runtime**):

```markdown
## Runtime

- **Local dev and tests:** Node **24.9+** (see `.nvmrc`). Required for Jest loading Nest 12 ESM packages.
- **Production:** Node **20.19+** or **22.12+** minimum; this repo’s Docker image uses Node 24.
```

- [ ] **Step 2: Confirm Node version**

Run: `node -v`  
Expected: `v24.9.0` or higher (e.g. `v24.18.0`).

- [ ] **Step 3: Record pre-upgrade baseline**

Run:

```bash
pnpm run lint
pnpm run build
pnpm test:unit
pnpm test:integration
```

Expected: all pass (integration tests need Docker for Testcontainers).

- [ ] **Step 4: Commit**

```bash
git add .nvmrc README.md
git commit -m "chore: pin Node 24 for Nest 12 upgrade baseline"
```

---

### Task 1: Upgrade Nest CLI and run `nest upgrade`

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`, possibly `nest-cli.json` (only if `nest upgrade` changes it)

**Interfaces:**

- Produces: all `@nestjs/*` dependencies at v12-compatible majors; `typescript` ^6 in devDependencies.

- [ ] **Step 1: Install Nest CLI 12 locally**

Run:

```bash
pnpm add -D @nestjs/cli@12 @nestjs/schematics@12 typescript@^6
```

If pnpm reports peer conflicts on `typescript-eslint` or `ts-jest`:

```bash
pnpm update typescript-eslint ts-jest
pnpm add -D @nestjs/cli@12 @nestjs/schematics@12 typescript@^6
```

- [ ] **Step 2: Dry-run upgrade**

Run:

```bash
pnpm exec nest upgrade --dry-run
```

Expected: printed plan listing package bumps and file edits (GraphQL, etc.). Read output; note anything beyond GraphQL/playground.

- [ ] **Step 3: Apply upgrade**

Run:

```bash
pnpm exec nest upgrade
pnpm install
```

- [ ] **Step 4: Verify lockfile versions**

Run:

```bash
pnpm list @nestjs/core @nestjs/common @nestjs/platform-fastify @nestjs/graphql @nestjs/config @nestjs/terminus typescript --depth 0
```

Expected: `@nestjs/core` **12.x**, `typescript` **6.x**, `@nestjs/graphql` **14.x**.

- [ ] **Step 5: First compile attempt**

Run: `pnpm run build`  
Expected: may **fail** until Tasks 2–3; capture errors for next tasks.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml nest-cli.json
git commit -m "chore: nest upgrade to v12 packages and TypeScript 6"
```

---

### Task 2: GraphQL GraphiQL migration

**Files:**

- Modify: `src/app.module.ts` (GraphQLModule config ~lines 184–200)

**Interfaces:**

- Consumes: `@nestjs/graphql` 14 / `@nestjs/apollo` 14 from Task 1.
- Produces: GraphQL IDE enabled via `graphiql` instead of deprecated `playground`.

- [ ] **Step 1: Replace `playground` with `graphiql`**

In `src/app.module.ts`, inside `GraphQLModule.forRoot<ApolloDriverConfig>({ ... })`, remove `playground: true` and add:

```typescript
      graphiql: true,
```

Full block should retain `driver`, `typePaths`, `context`, `definitions`, `validationRules` unchanged.

- [ ] **Step 2: Build**

Run: `pnpm run build`  
Expected: PASS (GraphQL config type-checks).

- [ ] **Step 3: Commit**

```bash
git add src/app.module.ts
git commit -m "fix(graphql): use graphiql instead of removed playground option"
```

---

### Task 3: Terminus v12 — `FeatureFlagHealthIndicator`

**Files:**

- Modify: `src/feature-flag/feature-flag.health.ts`
- Create: `src/feature-flag/feature-flag.health.spec.ts`

**Interfaces:**

- Consumes: `FeatureFlagService.getHealthStatus()`, `HealthIndicatorService` from `@nestjs/terminus`.
- Produces: `FeatureFlagHealthIndicator.isHealthy(key: string): Promise<HealthIndicatorResult>` — always **up** with informational metadata (same semantics as today).

- [ ] **Step 1: Write the failing test**

Create `src/feature-flag/feature-flag.health.spec.ts`:

```typescript
import { FeatureFlagHealthIndicator } from './feature-flag.health';
import { FeatureFlagService } from './feature-flag.service';
import { HealthIndicatorService } from '@nestjs/terminus';

describe('FeatureFlagHealthIndicator', () => {
  it('isHealthy always reports up with feature-flag metadata', async () => {
    const status = {
      stale: false,
      healthy: true,
      redisAvailable: false,
      pubSubConnected: false,
      flagCount: 3,
      lastReconciledAt: '2026-01-01T00:00:00.000Z',
      lastError: null as string | null,
    };

    const featureFlagService = {
      getHealthStatus: jest.fn().mockReturnValue(status),
    } as unknown as FeatureFlagService;

    const healthIndicatorService = {
      check: jest.fn().mockReturnValue({
        up: jest.fn().mockReturnValue({
          feature_flags: {
            status: 'up',
            stale: status.stale,
            healthy: status.healthy,
            redisAvailable: status.redisAvailable,
            pubSubConnected: status.pubSubConnected,
            flagCount: status.flagCount,
            lastReconciledAt: status.lastReconciledAt,
            lastError: status.lastError,
          },
        }),
      }),
    } as unknown as HealthIndicatorService;

    const indicator = new FeatureFlagHealthIndicator(
      featureFlagService,
      healthIndicatorService,
    );

    const result = await indicator.isHealthy('feature_flags');

    expect(featureFlagService.getHealthStatus).toHaveBeenCalled();
    expect(healthIndicatorService.check).toHaveBeenCalledWith('feature_flags');
    expect(result.feature_flags?.status).toBe('up');
    expect(result.feature_flags).toMatchObject({
      stale: false,
      redisAvailable: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- feature-flag.health.spec`  
Expected: FAIL (constructor arity / missing `HealthIndicatorService`).

- [ ] **Step 3: Implement Terminus v12 indicator**

Replace contents of `src/feature-flag/feature-flag.health.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Reports feature-flag subsystem status for observability.
 * Does NOT fail readiness — Redis outages must not take the app out of rotation.
 */
@Injectable()
export class FeatureFlagHealthIndicator {
  constructor(
    private readonly featureFlagService: FeatureFlagService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const status = this.featureFlagService.getHealthStatus();
    return this.healthIndicatorService.check(key).up({
      stale: status.stale,
      healthy: status.healthy,
      redisAvailable: status.redisAvailable,
      pubSubConnected: status.pubSubConnected,
      flagCount: status.flagCount,
      lastReconciledAt: status.lastReconciledAt,
      lastError: status.lastError,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- feature-flag.health.spec`  
Expected: PASS.

- [ ] **Step 5: Run health wire test**

Run: `pnpm test:unit -- health.ready.http.spec`  
Expected: PASS (mocks `FeatureFlagHealthIndicator` — no change required unless types break).

- [ ] **Step 6: Commit**

```bash
git add src/feature-flag/feature-flag.health.ts src/feature-flag/feature-flag.health.spec.ts
git commit -m "fix(health): migrate feature-flag indicator to Terminus v12 API"
```

---

### Task 4: Terminus Redis `pingCheck` timeout (fix only if build fails)

**Files:**

- Modify: `src/health/health.controller.ts` (optional, ~lines 94–103)

**Interfaces:**

- Consumes: `MicroserviceHealthIndicator` from `@nestjs/terminus` v12.

- [ ] **Step 1: Build and inspect**

Run: `pnpm run build`  
If **no** error on `timeout: 3000` inside `pingCheck`, skip remaining steps in this task.

- [ ] **Step 2: If TypeScript errors on `timeout`, remove deprecated option**

Replace the Redis push block’s `pingCheck` call with (keep transport/options; drop `timeout`):

```typescript
        this.microservice.pingCheck<RedisOptions>('redis', {
          transport: Transport.REDIS,
          options: {
            host: redisHost,
            port: this.configService.get<number>('REDIS_PORT', 6379),
          },
        }),
```

If runtime timeouts are required, follow Terminus v12 docs to chain `.withTimeout(3000)` on the indicator return value (read `node_modules/@nestjs/terminus` types after install and match the documented pattern).

- [ ] **Step 3: Run health tests**

Run: `pnpm test:unit -- health.ready.http.spec`  
Expected: PASS.

- [ ] **Step 4: Commit (if changed)**

```bash
git add src/health/health.controller.ts
git commit -m "fix(health): align Redis pingCheck with Terminus v12 timeout API"
```

---

### Task 5: Jest + Nest 12 ESM packages (conditional)

**Files:**

- Modify: `jest.config.ts`

**Interfaces:**

- Produces: unit tests load `@nestjs/*` v12 without `ERR_REQUIRE_ASYNC_MODULE`.

- [ ] **Step 1: Run full unit suite**

Run: `pnpm test:unit`  
If all pass, **skip** Steps 2–4.

- [ ] **Step 2: If Jest fails loading `@nestjs/*`, extend `transformIgnorePatterns`**

In `jest.config.ts`, append Nest packages to the existing allowlist inside `transformIgnorePatterns`:

```typescript
  transformIgnorePatterns: [
    String.raw`/node_modules/(?!.*(?:sanitize-html|htmlparser2|entities|domelementtype|domhandler|domutils|dom-serializer|escape-string-regexp|is-plain-object|@nestjs/bullmq|@nestjs/bull-shared|@nestjs/common|@nestjs/core|@nestjs/platform-fastify|@nestjs/testing|@nestjs/terminus|@nestjs/config|@nestjs/microservices|@nestjs/websockets|bullmq|msgpackr)(?:/|$))`,
  ],
```

- [ ] **Step 3: Re-run unit tests**

Run: `pnpm test:unit`  
Expected: PASS.

- [ ] **Step 4: Commit (if changed)**

```bash
git add jest.config.ts
git commit -m "test: allow Jest to transform Nest 12 ESM packages"
```

---

### Task 6: Toolchain fixups after TypeScript 6

**Files:**

- Modify: `package.json` (devDependencies), possibly `eslint.config` / `tsconfig.json` if `nest upgrade` left strict errors

- [ ] **Step 1: Lint and typecheck**

Run:

```bash
pnpm run lint
pnpm run build
```

- [ ] **Step 2: If `typescript-eslint` peer fails, bump**

Run:

```bash
pnpm update typescript-eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
pnpm run lint
```

- [ ] **Step 3: If ts-jest fails on TS 6, bump ts-jest**

Run:

```bash
pnpm add -D ts-jest@latest
pnpm test:unit -- --passWithNoTests 2>&1 | head -30
```

Fix any reported `ts-jest` / `typescript` peer mismatch per pnpm output.

- [ ] **Step 4: Commit (if package.json changed)**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: align eslint and ts-jest with TypeScript 6"
```

---

### Task 7: Clean pnpm overrides and Docker Node image

**Files:**

- Modify: `package.json` (`pnpm.overrides`)
- Modify: `Dockerfile`

- [ ] **Step 1: Remove obsolete Nest 11 security overrides**

In `package.json` → `pnpm.overrides`, delete these entries (only if versions are now natively ≥ patched releases):

```json
      "@nestjs/core@<=11.1.17": ">=11.1.18",
      "@nestjs/microservices@<=11.1.18": ">=11.1.19",
      "@nestjs/platform-fastify@<=11.1.23": ">=11.1.24",
```

Run: `pnpm install`  
Expected: lockfile resolves without pulling `@nestjs/*` 11.x.

- [ ] **Step 2: Bump Docker base image**

In `Dockerfile`, change both stages:

```dockerfile
FROM node:24-alpine AS builder
```

and

```dockerfile
FROM node:24-alpine AS production
```

(Alternative: `node:22.12-alpine` if you must stay on 22 LTS; do not use unqualified `node:22-alpine` below 22.12.)

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml Dockerfile
git commit -m "chore: drop Nest 11 overrides and bump Docker Node for v12"
```

---

### Task 8: Phase 1 verification gate (“nothing breaks”)

**Files:**

- Create: `docs/operations/nestjs-12-upgrade.md`

**Interfaces:**

- Produces: written record of success criteria and commands for future upgrades.

- [ ] **Step 1: Full automated gate**

Run (in order):

```bash
pnpm run lint
pnpm run build
pnpm test:unit
pnpm test:integration
```

Expected: all PASS.

- [ ] **Step 2: Smoke graceful shutdown**

Run:

```bash
pnpm run build
pnpm run smoke:shutdown
```

Expected: script exits 0; `/health/ready` behavior unchanged during SIGTERM (see script output).

- [ ] **Step 3: Manual spot checks (local, optional but recommended)**

With `.env` / docker-compose services running:

1. `pnpm run start:dev` — app boots without GraphQL playground deprecation crash.
2. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health/ready` — `200` when dependencies up.
3. Open GraphiQL at `/graphql` (or path shown in logs) — schema loads.

- [ ] **Step 4: Write upgrade doc**

Create `docs/operations/nestjs-12-upgrade.md`:

```markdown
# NestJS 12 upgrade (Phase 1)

## What changed

- Nest framework and platform packages: 11 → 12.
- `@nestjs/graphql` / `@nestjs/apollo`: 13 → 14; GraphQL IDE: `graphiql` replaces `playground`.
- `@nestjs/terminus`: 12; custom feature-flag health uses `HealthIndicatorService`.
- TypeScript 6; Node 24.9+ for local tests (see `.nvmrc`).

## What did not change

- class-validator + ValidationPipe; SanitizationPipe order.
- Fastify AJV options in `src/main.ts`.
- OpenTelemetry via `src/instrumentation.ts` (no `@nestjs/observe` in Phase 1).

## Verify after future Nest bumps

pnpm run lint && pnpm run build && pnpm test:unit && pnpm test:integration && pnpm run smoke:shutdown
```

- [ ] **Step 5: Commit**

```bash
git add docs/operations/nestjs-12-upgrade.md
git commit -m "docs: record NestJS 12 Phase 1 upgrade and verification"
```

---

## Spec self-review (plan author checklist)

| Requirement                                         | Task                                                  |
| --------------------------------------------------- | ----------------------------------------------------- |
| Phase 1 success: build + unit + integration + smoke | Task 8                                                |
| Section 2 package alignment                         | Task 1, 7                                             |
| No Zod / Standard Schema                            | Global Constraints                                    |
| GraphQL breaking change                             | Task 2                                                |
| Terminus breaking change                            | Task 3, 4                                             |
| Jest + Node 24.9+                                   | Task 0, 5                                             |
| class-validator unchanged                           | Global Constraints                                    |
| Docker Node floor                                   | Task 7                                                |
| Overrides cleanup                                   | Task 7                                                |
| Lifecycle / `@Optional()`                           | Verify via full test suite; audit if DI errors appear |

**Placeholder scan:** No TBD steps; conditional tasks include explicit skip criteria.

---

## Execution handoff

Plan complete and saved to `intent/nestjs-v12-phase1-upgrade/plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — run tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
