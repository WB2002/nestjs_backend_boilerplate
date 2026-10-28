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

## Lease reclaim

When a worker dies or exceeds `BACKGROUND_JOBS_CLAIM_LEASE_SEC`, rows can remain in `processing` until the lease expires. `JobLeaseReclaimService` polls Postgres on an interval (all VMs with `BACKGROUND_JOBS_ENABLED=true` unless disabled below).

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `BACKGROUND_JOBS_LEASE_RECLAIM_ENABLED` | `true` | Set `false` to disable the cron |
| `BACKGROUND_JOBS_LEASE_RECLAIM_INTERVAL_MS` | `30000` | Poll interval |
| `BACKGROUND_JOBS_LEASE_RECLAIM_BATCH_SIZE` | `100` | Max rows reclaimed per tick |

Behavior:

- `processing` + `lease_until < now()` → `pending` with `run_at = now`, then BullMQ job re-added (`jobId` = row id)
- Same row but `attempts >= max_attempts` → terminal `failed` with lease-expired `last_error`
- `attempts` is **not** incremented again on reclaim (already bumped at claim time)

Set `BACKGROUND_JOBS_CLAIM_LEASE_SEC` above worst-case handler duration. Handlers do not verify lease ownership on completion; a zombie worker could still mark a row completed after reclaim.

## Follow-ups (not implemented)

- Priority queues / API load-shedding integration
