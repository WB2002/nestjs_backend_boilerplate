import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../constants';
import type { CountryAccessModuleOptions } from '../../config/country-access.config';

export function createPostgresPool(
  options: CountryAccessModuleOptions['postgres'],
): Pool {
  return new Pool({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
  });
}

@Injectable()
export class PostgresPoolLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresPoolLifecycle.name);

  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.pool.end();
    } catch (err) {
      this.logger.warn(
        `Failed to close Postgres pool: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
