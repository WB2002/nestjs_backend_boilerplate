import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';

const WORKER_CLOSE_TIMEOUT_MS = 10_000;

@Injectable()
export class BackgroundJobsShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(BackgroundJobsShutdownService.name);
  private workers: Worker[] = [];

  registerWorker(worker: Worker): void {
    this.workers.push(worker);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      this.workers.map(async (worker) => {
        try {
          await Promise.race([
            worker.close(),
            new Promise((_, reject) => {
              setTimeout(
                () => reject(new Error('worker close timeout')),
                WORKER_CLOSE_TIMEOUT_MS,
              );
            }),
          ]);
        } catch (err) {
          this.logger.warn(
            `Background job worker close: ${err instanceof Error ? err.message : err}`,
          );
        }
      }),
    );
  }
}
