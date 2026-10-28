import { Injectable, Logger } from '@nestjs/common';
import type { JobHandler } from '@/core/background-jobs/handlers/job-handler.types';

export const EXAMPLE_ECHO_JOB_NAME = 'example.echo';

@Injectable()
export class ExampleEchoJobHandler implements JobHandler {
  private readonly logger = new Logger(ExampleEchoJobHandler.name);

  async handle(payload: unknown): Promise<void> {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof (payload as { message: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : JSON.stringify(payload);
    this.logger.log(`Echo job: ${message}`);
  }
}
