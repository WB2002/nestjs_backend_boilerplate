import {
  Controller,
  Get,
  OnModuleDestroy,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
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
import { Pool } from 'pg';
import type {
  HealthCheckResult,
  HealthIndicatorFunction,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { Public } from '@/common/decorators/public.decorator';
import { ShutdownState } from '@/core/shutdown';
import { SkipRateLimit } from '@/core/rate-limiter';
import { SkipRequestDeadline } from '@/core/request-deadline';
import { SkipCountryAccess } from '@/common/country-access';
import { SkipInboundBulkhead } from '@/core/overload';
import { SkipTracing } from '@/core/telemetry';
import { FeatureFlagHealthIndicator } from '@/core/feature-flag';
import { RedisService } from '@/common/redis/redis.service';
import { HealthSnapshot } from './health-snapshot';
import { resolveHealthResponseMode } from './resolve-health-response-mode';

// Probes must never be throttled: load balancers share source IPs, and a 429
// during a rolling deploy looks like an unhealthy instance.
// SkipRequestDeadline: LB probes must not be 504'd by client/default timeouts.
// SkipCountryAccess: LB probes must not be blocked by geo restrictions.
@Public()
@SkipRateLimit()
@SkipRequestDeadline()
@SkipCountryAccess()
@SkipInboundBulkhead()
@SkipTracing()
@Controller('health')
export class HealthController implements OnModuleDestroy {
  private readonly snapshot: HealthSnapshot<HealthCheckResult>;
  private pgPool: Pool | undefined;

  constructor(
    private health: HealthCheckService,
    private mongoose: MongooseHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private microservice: MicroserviceHealthIndicator,
    private configService: ConfigService,
    private shutdownState: ShutdownState,
    private featureFlagHealth: FeatureFlagHealthIndicator,
    @Optional() private redisService?: RedisService,
  ) {
    const rawTtl = this.configService.get<string | number>(
      'HEALTH_CHECK_CACHE_TTL_MS',
    );
    const parsedTtl =
      typeof rawTtl === 'number'
        ? rawTtl
        : Number.parseInt(String(rawTtl ?? ''), 10);
    const ttlMs =
      Number.isFinite(parsedTtl) && parsedTtl >= 0 ? parsedTtl : 2000;
    this.snapshot = new HealthSnapshot<HealthCheckResult>(ttlMs);
  }

  @Get('live')
  live(): { status: string } {
    if (this.shutdownState.isShuttingDown) {
      throw new ServiceUnavailableException('Application is shutting down');
    }
    return { status: 'ok' };
  }

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.presentHealthResult(
      this.snapshot.get(() => this.health.check(this.buildChecks())),
    );
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    if (this.shutdownState.isShuttingDown) {
      return this.presentHealthResult(
        this.health.check([
          () =>
            Promise.resolve({
              shuttingDown: {
                status: 'down' as const,
                message: 'Application is shutting down',
              },
            }),
        ]),
      );
    }
    return this.presentHealthResult(
      this.snapshot.get(() => this.health.check(this.buildChecks())),
    );
  }

  private async presentHealthResult(
    healthCheckPromise: Promise<HealthCheckResult>,
  ): Promise<HealthCheckResult> {
    const healthCheckOutcome = await healthCheckPromise;
    if (resolveHealthResponseMode(this.configService) === 'minimal') {
      return {
        status: healthCheckOutcome.status,
        details: {},
      };
    }
    return healthCheckOutcome;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end().catch(() => {});
      this.pgPool = undefined;
    }
  }

  private buildChecks(): HealthIndicatorFunction[] {
    const checks: HealthIndicatorFunction[] = [
      // MongoDB check (wrapped so connection failures never crash the process)
      async () => {
        try {
          return await this.mongoose.pingCheck('mongo');
        } catch {
          return {
            mongo: { status: 'down' as const, message: 'Unavailable' },
          };
        }
      },

      // Memory check (heap used > 150MB)
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),

      // Disk check (storage used > 90% of total at path)
      () =>
        this.disk.checkStorage('storage', {
          path: '/',
          thresholdPercent: 0.9,
        }),

      // Feature flags: informational only (never fails readiness on Redis outage)
      () => this.featureFlagHealth.isHealthy('feature_flags'),
    ];

    // Redis check (only when Redis is configured in docker-compose / env)
    const redisHost = this.configService.get<string>('REDIS_HOST');
    if (redisHost) {
      if (this.redisService) {
        checks.push(() => this.pingRedis());
      } else {
        checks.push(() =>
          this.microservice
            .pingCheck<RedisOptions>('redis', {
              transport: Transport.REDIS,
              options: {
                host: redisHost,
                port: this.configService.get<number>('REDIS_PORT', 6379),
              },
            })
            .withTimeout(3000),
        );
      }
    }

    // Postgres check (only when Postgres is configured in docker-compose / env)
    const postgresDb = this.configService.get<string>('POSTGRES_DB');
    if (postgresDb) {
      checks.push(() => this.pingPostgres());
    }

    return checks;
  }

  private getPgPool(): Pool {
    if (!this.pgPool) {
      this.pgPool = new Pool({
        host: this.configService.get<string>('POSTGRES_HOST', 'localhost'),
        port: this.configService.get<number>('POSTGRES_PORT', 5432),
        user: this.configService.get<string>('POSTGRES_USER'),
        password: this.configService.get<string>('POSTGRES_PASSWORD'),
        database: this.configService.get<string>('POSTGRES_DB'),
        max: 1,
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 30000,
      });
      this.pgPool.on('error', () => {
        // Prevent unhandled error event on idle client disconnect
      });
    }
    return this.pgPool;
  }

  private async pingRedis(): Promise<HealthIndicatorResult<'redis'>> {
    try {
      const client = this.redisService!.getClient();
      await Promise.race([
        client.ping(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Redis ping timeout')),
            3000,
          );
          timer.unref?.();
        }),
      ]);
      return { redis: { status: 'up' as const } };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Connection failed';
      return { redis: { status: 'down' as const, message } };
    }
  }

  private async pingPostgres(): Promise<HealthIndicatorResult<'postgres'>> {
    try {
      const pool = this.getPgPool();
      await pool.query('SELECT 1');
      return { postgres: { status: 'up' as const } };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Connection failed';
      return { postgres: { status: 'down' as const, message } };
    }
  }
}
