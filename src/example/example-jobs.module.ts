import { Module } from '@nestjs/common';
import { ExampleJobsController } from './example-jobs.controller';
import { ExampleJobsHandlersRegistration } from './example-jobs-handlers.registration';
import { ExampleEchoJobHandler } from './jobs/example-echo.job-handler';

@Module({
  controllers: [ExampleJobsController],
  providers: [ExampleEchoJobHandler, ExampleJobsHandlersRegistration],
})
export class ExampleJobsModule {}
