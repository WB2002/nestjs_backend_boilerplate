# Background jobs (BullMQ + PostgreSQL SKIP LOCKED)

## Overview

Durable background work for **multi-VM** deployments:

1. **Postgres** `background_jobs` table is the source of truth.
2. **BullMQ** (shared **Redis**) delivers work to any app instance.
3. Workers **claim** a row with `SELECT … FOR UPDATE SKIP LOCKED` before running handlers — duplicate BullMQ deliveries do not double-execute.

```text
API / service
    │ insert pending row
    ▼
Postgres background_jobs
    │ enqueue { jobRowId }
    ▼
Redis (BullMQ queue: background-jobs)
    │ any VM worker
    ▼
SKIP LOCKED claim → handler → completed / failed / requeue
```

## Enabling

Requires **Postgres** (migration `002_create_background_jobs.sql`) and **Redis**.

```bash
BACKGROUND_JOBS_ENABLED=true
BACKGROUND_WORKER_ENABLED=true   # false on enqueue-only VMs
POSTGRES_HOST=...
POSTGRES_DB=...
```

Apply migration:

```bash
psql "$POSTGRES_URL" -f migrations/postgres/002_create_background_jobs.sql
```

## Demo API

`POST /example/jobs/echo` (public, like other example routes)

```json
{ "message": "hello", "dedupeKey": "optional-key" }
```

Registers handler `example.echo` via `ExampleJobsModule`.

## Dedupe

Optional `dedupe_key` on enqueue. Partial unique index prevents a second **pending/processing** row with the same key. `NULL` dedupe keys allow duplicates.

## Handler registration

Inject `JobHandlerRegistry` and register in `onModuleInit`:

```typescript
this.registry.register('my.job', handler);
```

Enqueue with `JobEnqueueService.enqueue({ jobName: 'my.job', payload: { ... } })`.

## Multi-VM

- **Enqueue-only VMs:** `BACKGROUND_JOBS_ENABLED=true`, `BACKGROUND_WORKER_ENABLED=false`
- **Worker VMs:** both `true`
- All instances: same `REDIS_HOST` and Postgres

BullMQ `jobId` equals the Postgres row `id`.

## Failure / retry

Handler errors requeue the row to `pending` with delayed `run_at` when `attempts < max_attempts`. Terminal failure sets `failed`. BullMQ may redeliver; unclaimed or already-completed rows are skipped safely.

## Follow-ups (not implemented)

- Reclaim rows stuck in `processing` after `lease_until` expires
- Priority queues / API load-shedding integration
