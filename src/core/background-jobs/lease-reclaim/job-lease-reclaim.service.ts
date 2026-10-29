import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { BackgroundJobsConfig } from '@/common/config/parse-background-jobs-config';
import { BACKGROUND_JOBS_CONFIG } from '../constants/background-jobs.constants';
import { JobEnqueueService } from '../job-enqueue.service';
import { PostgresJobRepository } from '../persistence/postgres/postgres-job.repository';
import { BackgroundJobStatus } from '../types/background-job.types';

@Injectable()
export class JobLeaseReclaimService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobLeaseReclaimService.name);
  private timer: NodeJS.Timeout | null = null;
  private isTickInFlight = false;

  constructor(
    private readonly repo: PostgresJobRepository,
    private readonly enqueue: JobEnqueueService,
    @Inject(BACKGROUND_JOBS_CONFIG)
    private readonly config: BackgroundJobsConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled || !this.config.leaseReclaimEnabled) {
      return;
    }
    this.stop();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.leaseReclaimIntervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    void this.tick();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  hasActiveTimer(): boolean {
    return this.timer !== null;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.isTickInFlight) {
      return;
    }
    this.isTickInFlight = true;
    try {
      const rows = await this.repo.reclaimExpiredLeases(
        this.config.leaseReclaimBatchSize,
      );
      for (const row of rows) {
        if (row.status === BackgroundJobStatus.Pending) {
          await this.enqueue.wakeJobRow(row.id, row.maxAttempts);
        }
      }
      if (rows.length > 0) {
        this.logger.log(
          `Reclaimed ${rows.length} expired background job lease(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Lease reclaim tick failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.isTickInFlight = false;
    }
  }
}
