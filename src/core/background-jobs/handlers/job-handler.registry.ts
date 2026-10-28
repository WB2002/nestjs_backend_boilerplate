import { Injectable } from '@nestjs/common';
import type { JobHandler } from './job-handler.types';

@Injectable()
export class JobHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(jobName: string, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
  }

  get(jobName: string): JobHandler {
    const handler = this.handlers.get(jobName);
    if (!handler) {
      throw new Error(`No job handler registered for job_name=${jobName}`);
    }
    return handler;
  }
}
