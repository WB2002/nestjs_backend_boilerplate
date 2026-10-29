# BullMQ + PostgreSQL SKIP LOCKED Background Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Redis-backed **BullMQ** workers that run on **any VM**, with **PostgreSQL `FOR UPDATE SKIP LOCKED`** claims so the same logical job is never processed twice across VMs (even when BullMQ redelivers).

**Architecture:** Producers **insert a row** into `background_jobs` (Postgres, durable source of truth) then **enqueue** a BullMQ job carrying `jobRowId`. Consumers on N VMs share one Redis queue; on each delivery the worker **claims the row in a transaction** using `SELECT … FOR UPDATE SKIP LOCKED` + `UPDATE` to `processing`. If claim returns zero rows, the worker **acknowledges BullMQ without running the handler** (already done or claimed elsewhere). Successful runs mark `completed`; failures mark `failed` or requeue per policy. Optional **`dedupe_key`** partial unique index prevents duplicate pending work.

**Tech Stack:** NestJS 11, BullMQ 5, `@nestjs/bullmq`, `ioredis` (existing `RedisService`), `pg` (Pool), Jest, `@testcontainers/postgresql` (existing pattern).

## Global Constraints

- **Runtime:** Node **22+**; package manager **pnpm** only; tests: `pnpm test:unit`, integration: `pnpm test:integration`.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for enums/unions.
- **Layout:** Platform code under `src/core/background-jobs/`; demo enqueue under `src/example/`; SQL under `migrations/postgres/`.
- **Multi-VM:** All VMs use the **same** `REDIS_HOST` and **same** Postgres; worker identity = `os.hostname()` + `process.pid`.
- **Graceful shutdown:** Workers must `close()` during Nest shutdown (after `ShutdownState` drain), aligned with existing `registerGracefulShutdown` in `src/main.ts`.
- **Health probes:** Do not enqueue/consume health paths; no change to `/health` exemptions.

---

## File map

| Responsibility | Create                                                                                      | Modify                                                       |
| -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| SQL            | `migrations/postgres/002_create_background_jobs.sql`, `002_create_background_jobs.down.sql` | —                                                            |
| Core module    | `src/core/background-jobs/**` (see tasks)                                                   | —                                                            |
| Config         | `src/common/config/parse-background-jobs-config.ts`                                         | `src/common/config/env.schema.ts`, `.env.example`            |
| App wiring     | —                                                                                           | `src/app.module.ts`, `src/main.ts` (shutdown hook if needed) |
| Demo           | `src/example/example-jobs.controller.ts`, `example-echo.job.ts`                             | `src/example/example.module.ts`                              |
| Docs           | `docs/features/background_jobs.feature.md`                                                  | `docs/features/features.md`                                  |
| Compose        | —                                                                                           | `docker-compose.yml` (document Postgres + worker env)        |

---

## Task 1: Dependencies and env schema

**Files:**

- Modify: `package.json`
- Modify: `src/common/config/env.schema.ts`
- Modify: `.env.example`
- Create: `src/common/config/parse-background-jobs-config.ts`
- Create: `src/common/config/parse-background-jobs-config.spec.ts`

**Interfaces:**

- Produces: `BackgroundJobsConfig` type and `parseBackgroundJobsConfig(configService): BackgroundJobsConfig`

- [ ] **Step 1: Write the failing test**

```typescript
// src/common/config/parse-background-jobs-config.spec.ts
import { parseBackgroundJobsConfig } from './parse-background-jobs-config';

describe('parseBackgroundJobsConfig', () => {
  it('requires Postgres when jobs are enabled', () => {
    expect(() =>
      parseBackgroundJobsConfig({
        BACKGROUND_JOBS_ENABLED: 'true',
        POSTGRES_DB: '',
        POSTGRES_HOST: 'localhost',
        POSTGRES_USER: 'u',
        POSTGRES_PASSWORD: 'p',
        POSTGRES_PORT: '5432',
      }),
    ).toThrow(/POSTGRES_DB/);
  });

  it('defaults worker off and queue name to default', () => {
    const cfg = parseBackgroundJobsConfig({
      BACKGROUND_JOBS_ENABLED: 'false',
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.workerEnabled).toBe(false);
    expect(cfg.defaultQueueName).toBe('default');
    expect(cfg.claimLeaseSec).toBe(300);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- parse-background-jobs-config.spec`
Expected: FAIL — module not found

- [ ] **Step 3: Add dependencies**

Run:

```bash
pnpm add bullmq @nestjs/bullmq
```

- [ ] **Step 4: Implement config parser and env keys**

Add to `env.schema.ts` (all optional):

- `BACKGROUND_JOBS_ENABLED`
- `BACKGROUND_WORKER_ENABLED`
- `BACKGROUND_JOBS_DEFAULT_QUEUE`
- `BACKGROUND_JOBS_CLAIM_LEASE_SEC`
- `BACKGROUND_JOBS_WORKER_CONCURRENCY`

Implement `parse-background-jobs-config.ts`:

```typescript
export type BackgroundJobsConfig = {
  enabled: boolean;
  workerEnabled: boolean;
  defaultQueueName: string;
  claimLeaseSec: number;
  workerConcurrency: number;
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
};

export function parseBackgroundJobsConfig(
  env: Record<string, string | undefined>,
): BackgroundJobsConfig {
  const enabled = env.BACKGROUND_JOBS_ENABLED === 'true';
  const workerEnabled = env.BACKGROUND_WORKER_ENABLED === 'true';
  const defaultQueueName =
    env.BACKGROUND_JOBS_DEFAULT_QUEUE?.trim() || 'default';
  const claimLeaseSec = parsePositiveInt(
    env.BACKGROUND_JOBS_CLAIM_LEASE_SEC,
    300,
  );
  const workerConcurrency = parsePositiveInt(
    env.BACKGROUND_JOBS_WORKER_CONCURRENCY,
    5,
  );

  const postgres = {
    host: env.POSTGRES_HOST?.trim() || 'localhost',
    port: parsePositiveInt(env.POSTGRES_PORT, 5432),
    user: env.POSTGRES_USER?.trim() || '',
    password: env.POSTGRES_PASSWORD ?? '',
    database: env.POSTGRES_DB?.trim() || '',
  };

  if (enabled && !postgres.database) {
    throw new Error(
      'POSTGRES_DB is required when BACKGROUND_JOBS_ENABLED=true',
    );
  }

  return {
    enabled,
    workerEnabled,
    defaultQueueName,
    claimLeaseSec,
    workerConcurrency,
    postgres,
  };
}
```

Mirror `.env.example`:

```bash
BACKGROUND_JOBS_ENABLED=false
BACKGROUND_WORKER_ENABLED=false
BACKGROUND_JOBS_DEFAULT_QUEUE=default
BACKGROUND_JOBS_CLAIM_LEASE_SEC=300
BACKGROUND_JOBS_WORKER_CONCURRENCY=5
```

- [ ] **Step 5: Run tests**

Run: `pnpm test:unit -- parse-background-jobs-config.spec`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/common/config/env.schema.ts \
  src/common/config/parse-background-jobs-config.ts \
  src/common/config/parse-background-jobs-config.spec.ts .env.example
git commit -m "feat(jobs): add BullMQ deps and background jobs env config"
```

---

## Task 2: PostgreSQL migration (job ledger + dedupe)

**Files:**

- Create: `migrations/postgres/002_create_background_jobs.sql`
- Create: `migrations/postgres/002_create_background_jobs.down.sql`

**Interfaces:**

- Produces: table `background_jobs` with columns used by repository in Task 3

- [ ] **Step 1: Add migration SQL**

`002_create_background_jobs.sql`:

```sql
CREATE TYPE background_job_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled'
);

CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  dedupe_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status background_job_status NOT NULL DEFAULT 'pending',
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT background_jobs_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT background_jobs_max_attempts_positive CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_poll
  ON background_jobs (status, run_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_background_jobs_processing_lease
  ON background_jobs (lease_until)
  WHERE status = 'processing';

CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_dedupe_active
  ON background_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND status IN ('pending', 'processing');
```

`002_create_background_jobs.down.sql`:

```sql
DROP TABLE IF EXISTS background_jobs;
DROP TYPE IF EXISTS background_job_status;
```

- [ ] **Step 2: Apply locally (manual check)**

Run: `psql "$POSTGRES_URL" -f migrations/postgres/002_create_background_jobs.sql`
Expected: `CREATE TYPE`, `CREATE TABLE`, indexes succeed

- [ ] **Step 3: Commit**

```bash
git add migrations/postgres/002_create_background_jobs.sql \
  migrations/postgres/002_create_background_jobs.down.sql
git commit -m "feat(jobs): add background_jobs postgres migration"
```

---

## Task 3: Job row types and Postgres repository (claim SQL)

**Files:**

- Create: `src/core/background-jobs/enums/background-job-status.enum.ts`
- Create: `src/core/background-jobs/types/background-job.types.ts`
- Create: `src/core/background-jobs/constants/background-jobs.constants.ts`
- Create: `src/core/background-jobs/persistence/postgres/postgres-job.repository.ts`
- Create: `src/core/background-jobs/persistence/postgres/postgres-job.repository.spec.ts`
- Create: `src/core/background-jobs/persistence/postgres/postgres.pool.ts`
- Create: `src/core/background-jobs/persistence/postgres/sql/claim-job.sql.ts` (exported SQL string)

**Interfaces:**

- Produces:
  - `PostgresJobRepository.insertPending(input): Promise<{ id: string } | null>` — `null` when dedupe conflicts
  - `PostgresJobRepository.claimById(input): Promise<BackgroundJobRow | null>`
  - `PostgresJobRepository.markCompleted(id): Promise<void>`
  - `PostgresJobRepository.markFailed(id, error, requeueAt?): Promise<void>`
- Consumes: `Pool` from `pg`

- [ ] **Step 1: Write failing unit test (claim returns null when not pending)**

```typescript
// postgres-job.repository.spec.ts — use jest mock Pool.query
it('claimById returns null when no row is claimable', async () => {
  pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  const row = await repo.claimById({
    id: '00000000-0000-4000-8000-000000000001',
    workerId: 'vm-a:1',
    leaseSec: 300,
  });
  expect(row).toBeNull();
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm test:unit -- postgres-job.repository.spec`
Expected: FAIL

- [ ] **Step 3: Implement claim with FOR UPDATE SKIP LOCKED**

Core SQL (used inside a single `pool.query` with CTE):

```sql
WITH picked AS (
  SELECT id
  FROM background_jobs
  WHERE id = $1::uuid
    AND status = 'pending'::background_job_status
    AND run_at <= NOW()
  FOR UPDATE SKIP LOCKED
)
UPDATE background_jobs AS j
SET
  status = 'processing'::background_job_status,
  locked_by = $2,
  locked_at = NOW(),
  lease_until = NOW() + make_interval(secs => $3::double precision),
  attempts = j.attempts + 1,
  updated_at = NOW()
FROM picked
WHERE j.id = picked.id
RETURNING
  j.id,
  j.queue_name,
  j.job_name,
  j.payload,
  j.attempts,
  j.max_attempts;
```

`insertPending` uses:

```sql
INSERT INTO background_jobs (
  queue_name, job_name, dedupe_key, payload, run_at, max_attempts
) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
ON CONFLICT DO NOTHING
RETURNING id;
```

Note: `ON CONFLICT` requires the partial unique index on `dedupe_key`; when `dedupe_key` IS NULL, duplicates are allowed (document in feature doc).

- [ ] **Step 4: Run unit tests**

Run: `pnpm test:unit -- postgres-job.repository.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/background-jobs/
git commit -m "feat(jobs): postgres job repository with SKIP LOCKED claim"
```

---

## Task 4: Integration test — two concurrent claimers, one winner

**Files:**

- Create: `src/core/background-jobs/persistence/postgres/postgres-job.repository.integration.spec.ts`

**Interfaces:**

- Consumes: `PostgresJobRepository` from Task 3

- [ ] **Step 1: Write failing integration test**

Pattern: mirror `postgres-country-access.repository.integration.spec.ts` — `@testcontainers/postgresql`, run migration `002`, insert pending row, open two pools, `Promise.all([claim, claim])`, assert exactly one non-null claim and one null; second claim after complete returns null.

```typescript
it('allows only one VM to claim the same job row', async () => {
  const id = await insertPendingRow(pool);
  const [a, b] = await Promise.all([
    repoA.claimById({ id, workerId: 'vm-a:1', leaseSec: 300 }),
    repoB.claimById({ id, workerId: 'vm-b:2', leaseSec: 300 }),
  ]);
  const winners = [a, b].filter(Boolean);
  expect(winners).toHaveLength(1);
});
```

- [ ] **Step 2: Run integration test**

Run: `pnpm test:integration -- postgres-job.repository.integration.spec`
Expected: PASS (after Task 3)

- [ ] **Step 3: Commit**

```bash
git add src/core/background-jobs/persistence/postgres/postgres-job.repository.integration.spec.ts
git commit -m "test(jobs): integration test for SKIP LOCKED single claim"
```

---

## Task 5: BullMQ connection and queue registration

**Files:**

- Create: `src/core/background-jobs/bullmq/create-bullmq-connection.ts`
- Create: `src/core/background-jobs/bullmq/background-jobs-bull.constants.ts`
- Create: `src/core/background-jobs/background-jobs.module.ts` (partial — providers only)
- Create: `src/core/background-jobs/bullmq/create-bullmq-connection.spec.ts`

**Interfaces:**

- Produces: `BACKGROUND_JOBS_QUEUE` token name constant; `createBullMqConnection(redis: Redis): ConnectionOptions` compatible with BullMQ
- Consumes: `RedisService.duplicate({ maxRetriesPerRequest: null })` — BullMQ **requires** `maxRetriesPerRequest: null` on ioredis

- [ ] **Step 1: Write failing test**

```typescript
it('sets maxRetriesPerRequest null on duplicate options', () => {
  const dup = createBullMqDuplicateOptions();
  expect(dup.maxRetriesPerRequest).toBeNull();
});
```

- [ ] **Step 2: Implement connection helper**

```typescript
import type { RedisOptions } from 'ioredis';

export function createBullMqDuplicateOptions(): RedisOptions {
  return { maxRetriesPerRequest: null, enableOfflineQueue: false };
}
```

Wire in module factory using `redisService.duplicate(createBullMqDuplicateOptions())`.

- [ ] **Step 3: Register BullModule in `BackgroundJobsModule`**

```typescript
BullModule.forRootAsync({
  inject: [RedisService],
  useFactory: (redisService: RedisService) => ({
    connection: redisService.duplicate(createBullMqDuplicateOptions()),
  }),
}),
BullModule.registerQueue({ name: BACKGROUND_JOBS_QUEUE_DEFAULT }),
```

Guard module with `BackgroundJobsConfig.enabled`.

- [ ] **Step 4: Commit**

```bash
git add src/core/background-jobs/
git commit -m "feat(jobs): BullMQ root and default queue registration"
```

---

## Task 6: Enqueue service (Postgres insert + BullMQ add)

**Files:**

- Create: `src/core/background-jobs/job-enqueue.service.ts`
- Create: `src/core/background-jobs/dto/enqueue-job.dto.ts`
- Create: `src/core/background-jobs/job-enqueue.service.spec.ts`

**Interfaces:**

- Produces: `JobEnqueueService.enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult>`
  - `EnqueueJobInput`: `{ queueName?, jobName, payload, dedupeKey?, runAt?, maxAttempts? }`
  - `EnqueueJobResult`: `{ jobRowId: string; enqueued: boolean; deduplicated: boolean }`
- Consumes: `PostgresJobRepository`, BullMQ `Queue` (`@InjectQueue`)

- [ ] **Step 1: Write failing test**

Mock repo + queue; assert `queue.add('run', { jobRowId }, { jobId: jobRowId, removeOnComplete: true, removeOnFail: false })` called after insert.

- [ ] **Step 2: Implement**

```typescript
async enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult> {
  const inserted = await this.repo.insertPending({ ... });
  if (!inserted) {
    return { jobRowId: '', enqueued: false, deduplicated: true };
  }
  await this.queue.add(
    BACKGROUND_JOBS_RUN_JOB_NAME,
    { jobRowId: inserted.id },
    {
      jobId: inserted.id,
      delay: Math.max(0, runAt.getTime() - Date.now()),
      removeOnComplete: true,
      attempts: input.maxAttempts ?? 5,
      backoff: { type: 'exponential', delay: 1000 },
    },
  );
  return { jobRowId: inserted.id, enqueued: true, deduplicated: false };
}
```

Use **stable BullMQ `jobId` = Postgres `id`** so Redis dedupes redelivery of the same row.

- [ ] **Step 3: Run unit tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/core/background-jobs/job-enqueue.service.ts src/core/background-jobs/dto/
git commit -m "feat(jobs): enqueue service with postgres ledger and BullMQ"
```

---

## Task 7: Claiming processor base + echo worker

**Files:**

- Create: `src/core/background-jobs/processors/claiming-processor.host.ts`
- Create: `src/core/background-jobs/processors/background-jobs-run.processor.ts`
- Create: `src/core/background-jobs/handlers/job-handler.registry.ts`
- Create: `src/example/jobs/example-echo.job-handler.ts`
- Create: `src/core/background-jobs/processors/background-jobs-run.processor.spec.ts`

**Interfaces:**

- Produces:
  - `ClaimingProcessorHost.process(job: Job<{ jobRowId: string }>): Promise<void>`
  - `JobHandlerRegistry` maps `job_name` → `JobHandler` interface `{ handle(payload: unknown): Promise<void> }`
- Consumes: `PostgresJobRepository`, registry

- [ ] **Step 1: Write failing processor test**

When claim returns null and row is `completed`, processor resolves without calling handler. When claim succeeds, handler runs once and `markCompleted` called.

- [ ] **Step 2: Implement processor flow**

```typescript
@Processor(BACKGROUND_JOBS_QUEUE_DEFAULT)
export class BackgroundJobsRunProcessor extends WorkerHost {
  async process(job: Job<{ jobRowId: string }>): Promise<void> {
    const workerId = `${hostname()}:${process.pid}`;
    const row = await this.repo.claimById({
      id: job.data.jobRowId,
      workerId,
      leaseSec: this.config.claimLeaseSec,
    });
    if (!row) {
      const status = await this.repo.getStatus(job.data.jobRowId);
      if (status === 'completed' || status === 'cancelled') {
        return;
      }
      if (status === 'processing') {
        return; // another worker owns an active lease
      }
      throw new Error(`Unclaimable job ${job.data.jobRowId} status=${status}`);
    }
    try {
      const handler = this.registry.get(row.job_name);
      await handler.handle(row.payload);
      await this.repo.markCompleted(row.id);
    } catch (err) {
      await this.repo.markFailed(row.id, err);
      throw err; // let BullMQ retry
    }
  }
}
```

Register processor only when `config.workerEnabled === true`.

- [ ] **Step 3: Echo handler**

`example-echo.job-handler.ts` logs payload `{ message: string }` — used by demo API.

- [ ] **Step 4: Run unit tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/core/background-jobs/processors/ src/core/background-jobs/handlers/ src/example/jobs/
git commit -m "feat(jobs): claiming BullMQ processor and echo handler"
```

---

## Task 8: Module wiring, app integration, graceful worker shutdown

**Files:**

- Modify: `src/core/background-jobs/background-jobs.module.ts` (complete)
- Create: `src/core/background-jobs/background-jobs.shutdown.service.ts`
- Create: `src/core/background-jobs/index.ts`
- Modify: `src/app.module.ts`
- Modify: `src/example/example.module.ts`

**Interfaces:**

- Produces: `BackgroundJobsModule` exports `JobEnqueueService`
- Consumes: `ShutdownState`, BullMQ `Worker` close on shutdown

- [ ] **Step 1: Write failing test for shutdown service**

Mock worker with `close: jest.fn()`; on `onApplicationShutdown`, expect `close` called.

- [ ] **Step 2: Implement `BackgroundJobsShutdownService`**

On `onApplicationShutdown`, await `worker.close()` (and queue `close()` if needed) with timeout; log warnings on hang.

- [ ] **Step 3: Wire `AppModule`**

```typescript
...(parseBackgroundJobsEnabled(config) ? [BackgroundJobsModule] : []),
```

Use factory that reads `ConfigService` — same pattern as `isWebSocketEnabled()`.

- [ ] **Step 4: Manual smoke (two terminals, optional)**

Terminal A & B: `BACKGROUND_JOBS_ENABLED=true BACKGROUND_WORKER_ENABLED=true pnpm start:dev`  
Enqueue one job via demo endpoint; verify logs show **one** echo execution.

- [ ] **Step 5: Commit**

```bash
git add src/core/background-jobs/ src/app.module.ts src/example/example.module.ts
git commit -m "feat(jobs): wire background jobs module and worker shutdown"
```

---

## Task 9: Demo HTTP enqueue API

**Files:**

- Create: `src/example/example-jobs.controller.ts`
- Create: `src/example/example-jobs.controller.spec.ts`
- Modify: `src/example/example.module.ts`

**Interfaces:**

- Consumes: `JobEnqueueService`
- Produces: `POST /example/jobs/echo` body `{ message: string; dedupeKey?: string }`

- [ ] **Step 1: Write failing controller test**

Supertest-style or direct controller test with mocked enqueue service.

- [ ] **Step 2: Implement controller**

Use `@Public()` for demo parity with other example routes, or `@RequirePermissions` if you prefer admin-only — **match `example-captcha.controller.ts` pattern** (`@Public()`).

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/example/example-jobs.controller.ts src/example/example-jobs.controller.spec.ts
git commit -m "feat(jobs): example enqueue endpoint for echo job"
```

---

## Task 10: Documentation and feature index

**Files:**

- Create: `docs/features/background_jobs.feature.md`
- Modify: `docs/features/features.md`
- Modify: `docker-compose.yml` (uncomment Postgres service block + note worker env on `app`)

**Content requirements for `background_jobs.feature.md`:**

- Diagram: API → Postgres insert → BullMQ → any VM worker → SKIP LOCKED claim → handler
- Multi-VM deployment: M VMs may run workers; **same** Redis + Postgres
- Dedupe semantics for `dedupe_key`
- Env vars table
- Migration apply command
- Failure modes: BullMQ retry vs Postgres `failed` / lease expiry (v1: no auto reclaim of expired leases — document as follow-up)

- [ ] **Step 1: Write doc file**

- [ ] **Step 2: Update `features.md`**

Change Background jobs row from **Missing** to **Done** with link.

- [ ] **Step 3: Commit**

```bash
git add docs/features/background_jobs.feature.md docs/features/features.md docker-compose.yml
git commit -m "docs(jobs): background jobs feature doc and index update"
```

---

## Self-review (plan author checklist)

| Requirement                | Task                               |
| -------------------------- | ---------------------------------- |
| BullMQ multi-VM workers    | 5, 7, 8                            |
| No duplicate processing    | 3, 4, 7 (`FOR UPDATE SKIP LOCKED`) |
| Postgres source of truth   | 2, 3, 6                            |
| Dedupe enqueue             | 2 (partial unique index), 6        |
| Graceful shutdown          | 8                                  |
| Tests (unit + integration) | 1, 3, 4, 6, 7, 9                   |
| Docs                       | 10                                 |

**Placeholder scan:** No TBD steps; SQL and signatures are concrete.

**Follow-ups (explicitly out of scope for this plan):**

- Reclaim rows stuck in `processing` after `lease_until` (cron job with `SKIP LOCKED` poll)
- Separate worker-only deployment artifact (can run same image with `BACKGROUND_WORKER_ENABLED=true`)
- Priority queues / API load-shedding integration

---

## Execution handoff

Plan complete and saved to `intent/bullmq-postgres-skip-locked-jobs/plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — implement task-by-task in this session using executing-plans with checkpoints

Which approach do you want?
