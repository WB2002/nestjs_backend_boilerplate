export const CLAIM_JOB_BY_ID_SQL = `
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
`;

export const INSERT_PENDING_JOB_SQL = `
INSERT INTO background_jobs (
  queue_name,
  job_name,
  dedupe_key,
  payload,
  run_at,
  max_attempts
) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
ON CONFLICT (dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND status IN ('pending'::background_job_status, 'processing'::background_job_status)
  DO NOTHING
RETURNING id;
`;

export const MARK_JOB_COMPLETED_SQL = `
UPDATE background_jobs
SET
  status = 'completed'::background_job_status,
  updated_at = NOW(),
  completed_at = NOW(),
  lease_until = NULL,
  locked_by = NULL,
  locked_at = NULL
WHERE id = $1::uuid;
`;

export const MARK_JOB_FAILED_SQL = `
UPDATE background_jobs
SET
  status = 'failed'::background_job_status,
  updated_at = NOW(),
  last_error = $2,
  lease_until = NULL,
  locked_by = NULL,
  locked_at = NULL,
  run_at = COALESCE($3::timestamptz, run_at)
WHERE id = $1::uuid;
`;

export const REQUEUE_JOB_FOR_RETRY_SQL = `
UPDATE background_jobs
SET
  status = 'pending'::background_job_status,
  updated_at = NOW(),
  last_error = $2,
  lease_until = NULL,
  locked_by = NULL,
  locked_at = NULL,
  run_at = $3::timestamptz
WHERE id = $1::uuid
  AND attempts < max_attempts;
`;

export const GET_JOB_STATUS_SQL = `
SELECT status::text AS status
FROM background_jobs
WHERE id = $1::uuid;
`;
