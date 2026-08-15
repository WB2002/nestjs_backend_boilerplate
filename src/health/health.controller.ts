import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  MongooseHealthIndicator,
  MemoryHealthIndicator,
  MicroserviceHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Transport, RedisOptions } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';
import { ShutdownState } from '../core/shutdown';
import { SkipRateLimit } from '../core/rate-limiter';
import { SkipRequestDeadline } from '../core/request-deadline';

// Probes must never be throttled: load balancers share source IPs, and a 429
// during a rolling deploy looks like an unhealthy instance.
// SkipRequestDeadline: LB probes must not be 504'd by client/default timeouts.
@Public()
@SkipRateLimit()
@SkipRequestDeadline()
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private mongoose: MongooseHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private microservice: MicroserviceHealthIndicator,
    private configService: ConfigService,
    private shutdownState: ShutdownState,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check(this.buildChecks());
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    if (this.shutdownState.isShuttingDown) {
      return this.health.check([
        () =>
          Promise.resolve({
            shuttingDown: {
              status: 'down' as const,
              message: 'Application is shutting down',
            },
          }),
      ]);
    }
    return this.health.check(this.buildChecks());
  }

  private buildChecks(): Array<() => Promise<HealthIndicatorResult>> {
    const checks: Array<() => Promise<HealthIndicatorResult>> = [
      // MongoDB check (wrapped so connection failures never crash the process)
      () =>
        this.mongoose.pingCheck('mongo').catch(() => ({
          mongo: { status: 'down' as const, message: 'Unavailable' },
        })),

      // Memory check (heap used > 150MB)
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),

      // Disk check (storage used > 90% of total at path)
      () =>
        this.disk.checkStorage('storage', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ];

    // Redis check (only when Redis is configured in docker-compose / env)
    const redisHost = this.configService.get<string>('REDIS_HOST');
    if (redisHost) {
      checks.push(() =>
        this.microservice.pingCheck<RedisOptions>('redis', {
          transport: Transport.REDIS,
          options: {
            host: redisHost,
            port: this.configService.get<number>('REDIS_PORT', 6379),
          },
          timeout: 3000,
        }),
      );
    }

    // Postgres check (only when Postgres is configured in docker-compose / env)
    const postgresDb = this.configService.get<string>('POSTGRES_DB');
    if (postgresDb) {
      checks.push(() => this.pingPostgres());
    }

    return checks;
  }

  private async pingPostgres(): Promise<HealthIndicatorResult<'postgres'>> {
    const client = new Client({
      host: this.configService.get<string>('POSTGRES_HOST', 'localhost'),
      port: this.configService.get<number>('POSTGRES_PORT', 5432),
      user: this.configService.get<string>('POSTGRES_USER'),
      password: this.configService.get<string>('POSTGRES_PASSWORD'),
      database: this.configService.get<string>('POSTGRES_DB'),
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { postgres: { status: 'up' as const } };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Connection failed';
      return { postgres: { status: 'down' as const, message } };
    } finally {
      await client.end().catch(() => {});
    }
  }
}
