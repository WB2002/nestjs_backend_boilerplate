import { ConfigService } from '@nestjs/config';

export type BackgroundJobsPostgresConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export type BackgroundJobsConfig = {
  enabled: boolean;
  workerEnabled: boolean;
  defaultQueueName: string;
  claimLeaseSec: number;
  workerConcurrency: number;
  leaseReclaimEnabled: boolean;
  leaseReclaimIntervalMs: number;
  leaseReclaimBatchSize: number;
  orphanMinAgeSec: number;
  postgres: BackgroundJobsPostgresConfig;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseBackgroundJobsConfig(
  env: Record<string, string | undefined>,
): BackgroundJobsConfig {
  const isEnabled = env.BACKGROUND_JOBS_ENABLED === 'true';
  const isWorkerEnabled = env.BACKGROUND_WORKER_ENABLED === 'true';
  const defaultQueueName =
    env.BACKGROUND_JOBS_DEFAULT_QUEUE?.trim() || 'default';
  const claimLeaseSec = parsePositiveInt(
    env.BACKGROUND_JOBS_CLAIM_LEASE_SEC,
    300,
  );
  const workerConcurrency = parsePositiveInt(
    env.BACKGROUND_JOBS_WORKER_CONCURRENCY,
    5,
  );
  const isLeaseReclaimEnabled =
    env.BACKGROUND_JOBS_LEASE_RECLAIM_ENABLED !== 'false';
  const leaseReclaimIntervalMs = parsePositiveInt(
    env.BACKGROUND_JOBS_LEASE_RECLAIM_INTERVAL_MS,
    30_000,
  );
  const leaseReclaimBatchSize = parsePositiveInt(
    env.BACKGROUND_JOBS_LEASE_RECLAIM_BATCH_SIZE,
    100,
  );
  const orphanMinAgeSec = parsePositiveInt(
    env.BACKGROUND_JOBS_ORPHAN_MIN_AGE_SEC,
    30,
  );

  const postgres: BackgroundJobsPostgresConfig = {
    host: env.POSTGRES_HOST?.trim() || 'localhost',
    port: parsePositiveInt(env.POSTGRES_PORT, 5432),
    user: env.POSTGRES_USER?.trim() || '',
    password: env.POSTGRES_PASSWORD ?? '',
    database: env.POSTGRES_DB?.trim() || '',
  };

  if (isEnabled && !postgres.database) {
    throw new Error(
      'POSTGRES_DB is required when BACKGROUND_JOBS_ENABLED=true',
    );
  }

  return {
    enabled: isEnabled,
    workerEnabled: isWorkerEnabled,
    defaultQueueName,
    claimLeaseSec,
    workerConcurrency,
    leaseReclaimEnabled: isLeaseReclaimEnabled,
    leaseReclaimIntervalMs,
    leaseReclaimBatchSize,
    orphanMinAgeSec,
    postgres,
  };
}

export function parseBackgroundJobsConfigFromService(
  configService: ConfigService,
): BackgroundJobsConfig {
  return parseBackgroundJobsConfig({
    BACKGROUND_JOBS_ENABLED: configService.get<string>(
      'BACKGROUND_JOBS_ENABLED',
    ),
    BACKGROUND_WORKER_ENABLED: configService.get<string>(
      'BACKGROUND_WORKER_ENABLED',
    ),
    BACKGROUND_JOBS_DEFAULT_QUEUE: configService.get<string>(
      'BACKGROUND_JOBS_DEFAULT_QUEUE',
    ),
    BACKGROUND_JOBS_CLAIM_LEASE_SEC: configService.get<string>(
      'BACKGROUND_JOBS_CLAIM_LEASE_SEC',
    ),
    BACKGROUND_JOBS_WORKER_CONCURRENCY: configService.get<string>(
      'BACKGROUND_JOBS_WORKER_CONCURRENCY',
    ),
    BACKGROUND_JOBS_LEASE_RECLAIM_ENABLED: configService.get<string>(
      'BACKGROUND_JOBS_LEASE_RECLAIM_ENABLED',
    ),
    BACKGROUND_JOBS_LEASE_RECLAIM_INTERVAL_MS: configService.get<string>(
      'BACKGROUND_JOBS_LEASE_RECLAIM_INTERVAL_MS',
    ),
    BACKGROUND_JOBS_LEASE_RECLAIM_BATCH_SIZE: configService.get<string>(
      'BACKGROUND_JOBS_LEASE_RECLAIM_BATCH_SIZE',
    ),
    BACKGROUND_JOBS_ORPHAN_MIN_AGE_SEC: configService.get<string>(
      'BACKGROUND_JOBS_ORPHAN_MIN_AGE_SEC',
    ),
    POSTGRES_HOST: configService.get<string>('POSTGRES_HOST'),
    POSTGRES_PORT: configService.get<string>('POSTGRES_PORT'),
    POSTGRES_USER: configService.get<string>('POSTGRES_USER'),
    POSTGRES_PASSWORD: configService.get<string>('POSTGRES_PASSWORD'),
    POSTGRES_DB: configService.get<string>('POSTGRES_DB'),
  });
}
