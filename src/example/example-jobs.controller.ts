import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { JobEnqueueService } from '@/core/background-jobs';
import { EXAMPLE_ECHO_JOB_NAME } from './jobs/example-echo.job-handler';

export class EnqueueEchoJobDto {
  @IsString()
  @IsNotEmpty()
  declare message: string;

  @IsOptional()
  @IsString()
  declare dedupeKey?: string;
}

/**
 * Demo job enqueue API (non-production unless EXAMPLE_JOBS_API_ENABLED=true).
 * Body validated with class-validator and the global ValidationPipe.
 */
@ApiTags('example-jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('example/jobs')
export class ExampleJobsController {
  constructor(private readonly jobEnqueue: JobEnqueueService) {}

  @Post('echo')
  @ApiOperation({ summary: 'Enqueue a demo echo background job' })
  @ApiBody({ type: EnqueueEchoJobDto })
  async enqueueEcho(@Body() body: EnqueueEchoJobDto) {
    return this.jobEnqueue.enqueue({
      jobName: EXAMPLE_ECHO_JOB_NAME,
      payload: { message: body.message },
      ...(body.dedupeKey !== undefined ? { dedupeKey: body.dedupeKey } : {}),
    });
  }
}
