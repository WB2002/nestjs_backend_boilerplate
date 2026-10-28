import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { parseBackgroundJobStatus } from '../../enums/background-job-status.enum';
import {
  BackgroundJobStatus,
  type BackgroundJobRow,
  type ClaimJobInput,
  type InsertPendingJobInput,
  type ReclaimedLeaseRow,
} from '../../types/background-job.types';
import {
  BACKGROUND_JOBS_LEASE_EXPIRED_MESSAGE,
  BACKGROUND_JOBS_POSTGRES_POOL,
} from '../../constants/background-jobs.constants';
import {
  CLAIM_JOB_BY_ID_SQL,
  GET_JOB_STATUS_SQL,
  INSERT_PENDING_JOB_SQL,
  MARK_JOB_COMPLETED_SQL,
  MARK_JOB_FAILED_SQL,
  RECLAIM_EXPIRED_LEASES_SQL,
  REQUEUE_JOB_FOR_RETRY_SQL,
} from './sql/claim-job.sql';

type ClaimedRow = {
  id: string;
  queue_name: string;
  job_name: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

@Injectable()
export class PostgresJobRepository {
  constructor(
    @Inject(BACKGROUND_JOBS_POSTGRES_POOL) private readonly pool: Pool,
  ) {}

  async insertPending(
    input: InsertPendingJobInput,
  ): Promise<{ id: string } | null> {
    const result = await this.pool.query<{ id: string }>(
      INSERT_PENDING_JOB_SQL,
      [
        input.queueName,
        input.jobName,
        input.dedupeKey ?? null,
        JSON.stringify(input.payload ?? {}),
        input.runAt,
        input.maxAttempts,
      ],
    );
    const row = result.rows[0];
    return row ? { id: row.id } : null;
  }

  async claimById(input: ClaimJobInput): Promise<BackgroundJobRow | null> {
    const result = await this.pool.query<ClaimedRow>(CLAIM_JOB_BY_ID_SQL, [
      input.id,
      input.workerId,
      input.leaseSec,
    ]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return mapRow(row);
  }

  async getStatus(id: string): Promise<BackgroundJobStatus | null> {
    const result = await this.pool.query<{ status: string }>(
      GET_JOB_STATUS_SQL,
      [id],
    );
    const raw = result.rows[0]?.status;
    if (!raw) {
      return null;
    }
    return parseBackgroundJobStatus(raw) ?? null;
  }

  async markCompleted(id: string): Promise<void> {
    await this.pool.query(MARK_JOB_COMPLETED_SQL, [id]);
  }

  async reclaimExpiredLeases(limit: number): Promise<ReclaimedLeaseRow[]> {
    const result = await this.pool.query<{
      id: string;
      status: string;
      max_attempts: number;
    }>(RECLAIM_EXPIRED_LEASES_SQL, [
      limit,
      BACKGROUND_JOBS_LEASE_EXPIRED_MESSAGE,
    ]);
    return result.rows.flatMap((row) => {
      const status = parseBackgroundJobStatus(row.status);
      if (!status) {
        return [];
      }
      return [
        {
          id: row.id,
          status,
          maxAttempts: row.max_attempts,
        },
      ];
    });
  }

  async markFailed(
    id: string,
    error: unknown,
    requeueAt?: Date,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (requeueAt) {
      await this.pool.query(REQUEUE_JOB_FOR_RETRY_SQL, [
        id,
        message,
        requeueAt,
      ]);
      return;
    }
    await this.pool.query(MARK_JOB_FAILED_SQL, [id, message, null]);
  }
}

function mapRow(row: ClaimedRow): BackgroundJobRow {
  return {
    id: row.id,
    queueName: row.queue_name,
    jobName: row.job_name,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}
