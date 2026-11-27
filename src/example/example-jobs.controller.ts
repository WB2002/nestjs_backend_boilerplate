import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { JobEnqueueService } from '@/core/background-jobs';
import { EXAMPLE_ECHO_JOB_NAME } from './jobs/example-echo.job-handler';

class EnqueueEchoJobDto {
  @IsString()
  @IsNotEmpty()
  declare message: string;

  @IsOptional()
  @IsString()
  declare dedupeKey?: string;
}

@ApiTags('example-jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('example/jobs')
export class ExampleJobsController {
  constructor(private readonly jobEnqueue: JobEnqueueService) {}

  @Post('echo')
  @ApiOperation({ summary: 'Enqueue a demo echo background job' })
  async enqueueEcho(@Body() body: EnqueueEchoJobDto) {
    return this.jobEnqueue.enqueue({
      jobName: EXAMPLE_ECHO_JOB_NAME,
      payload: { message: body.message },
      ...(body.dedupeKey !== undefined ? { dedupeKey: body.dedupeKey } : {}),
    });
  }
}
