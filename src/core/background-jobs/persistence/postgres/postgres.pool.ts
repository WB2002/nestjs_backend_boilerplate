import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import type { BackgroundJobsPostgresConfig } from '@/common/config/parse-background-jobs-config';
import { BACKGROUND_JOBS_POSTGRES_POOL } from '../../constants/background-jobs.constants';

export function createBackgroundJobsPostgresPool(
  options: BackgroundJobsPostgresConfig,
): Pool {
  const pool = new Pool({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on?.('error', () => {
    // Prevent unhandled error event on idle client disconnect
  });
  return pool;
}

@Injectable()
export class BackgroundJobsPostgresPoolLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger(
    BackgroundJobsPostgresPoolLifecycle.name,
  );

  constructor(
    @Inject(BACKGROUND_JOBS_POSTGRES_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.pool.end();
    } catch (err) {
      this.logger.warn(
        `Failed to close background jobs Postgres pool: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
