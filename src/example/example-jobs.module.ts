import { Module } from '@nestjs/common';
import { ExampleJobsController } from './example-jobs.controller';

@Module({
  controllers: [ExampleJobsController],
})
export class ExampleJobsModule {}
