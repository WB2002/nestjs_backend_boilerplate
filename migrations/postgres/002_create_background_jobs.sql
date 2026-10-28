-- Durable job ledger for BullMQ workers (claim via FOR UPDATE SKIP LOCKED).
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
