import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { BackgroundJobsConfig } from '@/common/config/parse-background-jobs-config';
import {
  BACKGROUND_JOBS_BULL_QUEUE,
  BACKGROUND_JOBS_CONFIG,
  BACKGROUND_JOBS_RUN_JOB_NAME,
} from './constants/background-jobs.constants';
import type { EnqueueJobInput, EnqueueJobResult } from './dto/enqueue-job.dto';
import { PostgresJobRepository } from './persistence/postgres/postgres-job.repository';

@Injectable()
export class JobEnqueueService {
  constructor(
    private readonly repo: PostgresJobRepository,
    @InjectQueue(BACKGROUND_JOBS_BULL_QUEUE) private readonly queue: Queue,
    @Inject(BACKGROUND_JOBS_CONFIG) private readonly config: BackgroundJobsConfig,
  ) {}

  async enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult> {
    const queueName = input.queueName ?? this.config.defaultQueueName;
    const runAt = input.runAt ?? new Date();
    const maxAttempts = input.maxAttempts ?? 5;

    const inserted = await this.repo.insertPending({
      queueName,
      jobName: input.jobName,
      ...(input.dedupeKey !== undefined
        ? { dedupeKey: input.dedupeKey }
        : {}),
      payload: input.payload,
      runAt,
      maxAttempts,
    });

    if (!inserted) {
      return { jobRowId: '', enqueued: false, deduplicated: true };
    }

    const delayMs = Math.max(0, runAt.getTime() - Date.now());
    await this.queue.add(
      BACKGROUND_JOBS_RUN_JOB_NAME,
      { jobRowId: inserted.id },
      this.buildRunJobOptions(inserted.id, maxAttempts, delayMs),
    );

    return {
      jobRowId: inserted.id,
      enqueued: true,
      deduplicated: false,
    };
  }

  async wakeJobRow(jobRowId: string, maxAttempts: number): Promise<void> {
    const existing = await this.queue.getJob(jobRowId);
    if (existing) {
      const state = await existing.getState();
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'prioritized'
      ) {
        return;
      }
      await existing.remove();
    }
    await this.queue.add(
      BACKGROUND_JOBS_RUN_JOB_NAME,
      { jobRowId },
      this.buildRunJobOptions(jobRowId, maxAttempts, 0),
    );
  }

  private buildRunJobOptions(
    jobRowId: string,
    maxAttempts: number,
    delayMs: number,
  ): Parameters<Queue['add']>[2] {
    return {
      jobId: jobRowId,
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: maxAttempts,
      backoff: { type: 'exponential', delay: 1000 },
    };
  }
}
