import {
  DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import {
  DEFAULT_RATE_LIMITER_OPTIONS,
  RATE_LIMIT_BACKEND,
  RATE_LIMIT_OPTIONS,
} from './constants/rate-limit.constants';
import { RateLimitStorage } from './enums/rate-limit-storage.enum';
import { RateLimiterModuleOptions } from './types/rate-limit.types';
import { MemoryRateLimitBackend } from './backends/memory.backend';
import { RedisRateLimitBackend } from './backends/redis.backend';
import { FallbackRateLimitBackend } from './backends/fallback.backend';
import { parseHttpClientInstanceCount } from '@/core/http-client/resilience/parse-http-client-instance-count';
import { RateLimitBackend } from './types/rate-limit-backend.interface';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { GuestIdMiddleware } from './middleware/guest-id.middleware';

@Injectable()
class RateLimitBackendLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitBackendLifecycle.name);

  constructor(
    @Inject(RATE_LIMIT_BACKEND) private readonly backend: RateLimitBackend,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (typeof this.backend.quit === 'function') {
      try {
        await this.backend.quit();
      } catch (err) {
        this.logger.warn(
          `Failed to close rate-limit backend: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}

@Global()
@Module({})
export class RateLimiterModule {
  static forRoot(options: RateLimiterModuleOptions = {}): DynamicModule {
    const methods =
      options.methods ?? DEFAULT_RATE_LIMITER_OPTIONS.methods ?? [];
    const merged: RateLimiterModuleOptions = {
      ...DEFAULT_RATE_LIMITER_OPTIONS,
      ...options,
      methods,
      guestCookie: {
        ...DEFAULT_RATE_LIMITER_OPTIONS.guestCookie,
        ...options.guestCookie,
      },
    };

    return {
      module: RateLimiterModule,
      imports: [
        // ThrottlerModule is a DI shim so RateLimitGuard can extend ThrottlerGuard.
        ThrottlerModule.forRoot([
          {
            name: 'rate-limiter-shim',
            ttl: 60_000,
            limit: Number.MAX_SAFE_INTEGER,
          },
        ]),
      ],
      providers: [
        {
          provide: RATE_LIMIT_OPTIONS,
          useValue: merged,
        },
        this.createBackendProvider(),
        RateLimitGuard,
        GuestIdMiddleware,
        RateLimitBackendLifecycle,
      ],
      exports: [
        RATE_LIMIT_OPTIONS,
        RATE_LIMIT_BACKEND,
        RateLimitGuard,
        GuestIdMiddleware,
      ],
    };
  }

  static forRootAsync(options: {
    imports?: DynamicModule['imports'];
    inject?: unknown[];
    useFactory: (
      ...args: unknown[]
    ) => RateLimiterModuleOptions | Promise<RateLimiterModuleOptions>;
  }): DynamicModule {
    const optionsProvider: Provider = {
      provide: RATE_LIMIT_OPTIONS,
      useFactory: async (...args: unknown[]) => {
        const resolved = await options.useFactory(...args);
        const methods =
          resolved.methods ?? DEFAULT_RATE_LIMITER_OPTIONS.methods ?? [];
        return {
          ...DEFAULT_RATE_LIMITER_OPTIONS,
          ...resolved,
          methods,
          guestCookie: {
            ...DEFAULT_RATE_LIMITER_OPTIONS.guestCookie,
            ...resolved.guestCookie,
          },
        } satisfies RateLimiterModuleOptions;
      },
      inject: (options.inject ?? []) as never[],
    };

    return {
      module: RateLimiterModule,
      imports: [
        ...(options.imports ?? []),
        ThrottlerModule.forRoot([
          {
            name: 'rate-limiter-shim',
            ttl: 60_000,
            limit: Number.MAX_SAFE_INTEGER,
          },
        ]),
      ],
      providers: [
        optionsProvider,
        this.createBackendProvider(),
        RateLimitGuard,
        GuestIdMiddleware,
        RateLimitBackendLifecycle,
      ],
      exports: [
        RATE_LIMIT_OPTIONS,
        RATE_LIMIT_BACKEND,
        RateLimitGuard,
        GuestIdMiddleware,
      ],
    };
  }

  private static createBackendProvider(): Provider {
    return {
      provide: RATE_LIMIT_BACKEND,
      useFactory: (
        rateLimitOptions: RateLimiterModuleOptions,
        configService: ConfigService,
      ) => {
        if (rateLimitOptions.storage === RateLimitStorage.Redis) {
          const logger = new Logger('RateLimitRedis');
          const redis = new Redis({
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
          });
          redis.connect().catch((err: unknown) => {
            logger.error(
              `Redis rate-limit connect failed: ${err instanceof Error ? err.message : err}`,
            );
          });
          return new FallbackRateLimitBackend(
            new RedisRateLimitBackend(redis),
            new MemoryRateLimitBackend(),
            {
              instanceCount: parseHttpClientInstanceCount(
                configService.get('HTTP_CLIENT_INSTANCE_COUNT'),
              ),
              cooldownMs: Number(
                configService.get('RATE_LIMIT_FALLBACK_COOLDOWN_MS') ?? 5000,
              ),
            },
          );
        }
        return new MemoryRateLimitBackend();
      },
      inject: [RATE_LIMIT_OPTIONS, ConfigService],
    };
  }
}
