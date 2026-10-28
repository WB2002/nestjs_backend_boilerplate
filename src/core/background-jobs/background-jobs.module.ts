import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisService } from '@/common/redis/redis.service';
import {
  parseBackgroundJobsConfigFromService,
  type BackgroundJobsConfig,
} from '@/common/config/parse-background-jobs-config';
import { BackgroundJobsShutdownService } from './background-jobs.shutdown.service';
import { createBullMqDuplicateOptions } from './bullmq/create-bullmq-connection';
import {
  BACKGROUND_JOBS_BULL_QUEUE,
  BACKGROUND_JOBS_CONFIG,
  BACKGROUND_JOBS_POSTGRES_POOL,
} from './constants/background-jobs.constants';
import { JobHandlerRegistry } from './handlers/job-handler.registry';
import { JobEnqueueService } from './job-enqueue.service';
import {
  BackgroundJobsPostgresPoolLifecycle,
  createBackgroundJobsPostgresPool,
} from './persistence/postgres/postgres.pool';
import { PostgresJobRepository } from './persistence/postgres/postgres-job.repository';
import { JobLeaseReclaimService } from './lease-reclaim/job-lease-reclaim.service';
import { BackgroundJobsRunProcessor } from './processors/background-jobs-run.processor';

export type BackgroundJobsModuleOptions = {
  registerWorker: boolean;
};

@Global()
@Module({})
export class BackgroundJobsModule {
  static forRootAsync(options: BackgroundJobsModuleOptions): DynamicModule {
    const workerProviders = options.registerWorker
      ? [BackgroundJobsRunProcessor]
      : [];

    return {
      module: BackgroundJobsModule,
      imports: [
        ConfigModule,
        BullModule.forRootAsync({
          inject: [RedisService, ConfigService],
          useFactory: (
            redisService: RedisService,
            configService: ConfigService,
          ) => {
            const config = parseBackgroundJobsConfigFromService(configService);
            return {
              connection: redisService.duplicate(
                createBullMqDuplicateOptions(),
              ),
              ...(options.registerWorker
                ? { workerOptions: { concurrency: config.workerConcurrency } }
                : {}),
            };
          },
        }),
        BullModule.registerQueue({ name: BACKGROUND_JOBS_BULL_QUEUE }),
      ],
      providers: [
        {
          provide: BACKGROUND_JOBS_CONFIG,
          inject: [ConfigService],
          useFactory: (configService: ConfigService): BackgroundJobsConfig =>
            parseBackgroundJobsConfigFromService(configService),
        },
        {
          provide: BACKGROUND_JOBS_POSTGRES_POOL,
          inject: [BACKGROUND_JOBS_CONFIG],
          useFactory: (config: BackgroundJobsConfig) =>
            createBackgroundJobsPostgresPool(config.postgres),
        },
        BackgroundJobsPostgresPoolLifecycle,
        PostgresJobRepository,
        JobHandlerRegistry,
        JobEnqueueService,
        JobLeaseReclaimService,
        BackgroundJobsShutdownService,
        ...workerProviders,
      ],
      exports: [JobEnqueueService, JobHandlerRegistry, BACKGROUND_JOBS_CONFIG],
    };
  }
}
