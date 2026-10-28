import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '@/core/background-jobs';
import {
  EXAMPLE_ECHO_JOB_NAME,
  ExampleEchoJobHandler,
} from './jobs/example-echo.job-handler';

@Injectable()
export class ExampleJobsHandlersRegistration implements OnModuleInit {
  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly echoHandler: ExampleEchoJobHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register(EXAMPLE_ECHO_JOB_NAME, this.echoHandler);
  }
}
