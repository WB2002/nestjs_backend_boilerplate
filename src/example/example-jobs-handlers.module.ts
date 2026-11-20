import { Module } from '@nestjs/common';
import { ExampleJobsHandlersRegistration } from './example-jobs-handlers.registration';
import { ExampleEchoJobHandler } from './jobs/example-echo.job-handler';

@Module({
  providers: [ExampleEchoJobHandler, ExampleJobsHandlersRegistration],
})
export class ExampleJobsHandlersModule {}
