import { Body, Controller, Post } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Public } from '@/common/decorators/public.decorator';
import { JobEnqueueService } from '@/core/background-jobs';
import {
  EXAMPLE_ECHO_JOB_NAME,
} from './jobs/example-echo.job-handler';

class EnqueueEchoJobDto {
  @IsString()
  @IsNotEmpty()
  declare message: string;

  @IsOptional()
  @IsString()
  declare dedupeKey?: string;
}

@Controller('example/jobs')
export class ExampleJobsController {
  constructor(private readonly jobEnqueue: JobEnqueueService) {}

  @Public()
  @Post('echo')
  async enqueueEcho(@Body() body: EnqueueEchoJobDto) {
    return this.jobEnqueue.enqueue({
      jobName: EXAMPLE_ECHO_JOB_NAME,
      payload: { message: body.message },
      ...(body.dedupeKey !== undefined ? { dedupeKey: body.dedupeKey } : {}),
    });
  }
}
