import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { hostname } from 'node:os';
import type { BackgroundJobsConfig } from '@/common/config/parse-background-jobs-config';
import {
  BACKGROUND_JOBS_BULL_QUEUE,
  BACKGROUND_JOBS_CONFIG,
} from '../constants/background-jobs.constants';
import { JobHandlerRegistry } from '../handlers/job-handler.registry';
import { BackgroundJobStatus } from '../types/background-job.types';
import { PostgresJobRepository } from '../persistence/postgres/postgres-job.repository';

export type BackgroundJobsRunPayload = {
  jobRowId: string;
};

@Processor(BACKGROUND_JOBS_BULL_QUEUE)
export class BackgroundJobsRunProcessor extends WorkerHost {
  private readonly logger = new Logger(BackgroundJobsRunProcessor.name);

  constructor(
    private readonly repo: PostgresJobRepository,
    private readonly registry: JobHandlerRegistry,
    @Inject(BACKGROUND_JOBS_CONFIG)
    private readonly config: BackgroundJobsConfig,
  ) {
    super();
  }

  async process(job: Job<BackgroundJobsRunPayload>): Promise<void> {
    const workerId = `${hostname()}:${process.pid}`;
    const jobRowId = job.data.jobRowId;

    const row = await this.repo.claimById({
      id: jobRowId,
      workerId,
      leaseSec: this.config.claimLeaseSec,
    });

    if (!row) {
      const status = await this.repo.getStatus(jobRowId);
      if (
        status === BackgroundJobStatus.Completed ||
        status === BackgroundJobStatus.Cancelled
      ) {
        return;
      }
      if (status === BackgroundJobStatus.Processing) {
        this.logger.debug(
          `Skip BullMQ delivery; job ${jobRowId} already processing`,
        );
        return;
      }
      throw new Error(
        `Unclaimable background job ${jobRowId} (status=${status ?? 'missing'})`,
      );
    }

    try {
      const handler = this.registry.get(row.jobName);
      await handler.handle(row.payload);
      await this.repo.markCompleted(row.id);
    } catch (err) {
      if (row.attempts >= row.maxAttempts) {
        await this.repo.markFailed(row.id, err);
        return;
      }
      const delayMs = 1000 * row.attempts;
      await this.repo.markFailed(row.id, err, new Date(Date.now() + delayMs));
    }
  }
}
