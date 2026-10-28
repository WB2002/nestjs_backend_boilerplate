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
import Redis from 'ioredis';
import {
  CACHE_BACKEND,
  CACHE_LOADER_LOCK,
  CACHE_OPTIONS,
  DEFAULT_CACHE_KEY_PREFIX,
  DEFAULT_CACHE_OPTIONS,
} from './constants/cache.constants';
import { RedisCacheLoaderLock } from './lock/redis-cache-loader-lock';
import { CacheStorage } from './enums/cache-storage.enum';
import { MemoryCacheBackend } from './backends/memory.backend';
import { RedisCacheBackend } from './backends/redis.backend';
import { CacheBackend } from './types/cache-backend.interface';
import { CacheModuleOptions } from './types/cache.types';
import { CacheService } from './cache.service';

@Injectable()
class CacheBackendLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger(CacheBackendLifecycle.name);

  constructor(
    @Inject(CACHE_BACKEND) private readonly backend: CacheBackend,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (typeof this.backend.quit === 'function') {
      try {
        await this.backend.quit();
      } catch (err) {
        this.logger.warn(
          `Failed to close cache backend: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}

@Global()
@Module({})
export class CacheModule {
  static forRoot(options: CacheModuleOptions = {}): DynamicModule {
    const keyPrefix: string =
      options.keyPrefix ??
      DEFAULT_CACHE_OPTIONS.keyPrefix ??
      DEFAULT_CACHE_KEY_PREFIX;
    const merged: CacheModuleOptions = {
      ...DEFAULT_CACHE_OPTIONS,
      ...options,
      keyPrefix,
    };

    return {
      module: CacheModule,
      providers: [
        {
          provide: CACHE_OPTIONS,
          useValue: merged,
        },
        this.createBackendProvider(),
        this.createLoaderLockProvider(),
        CacheService,
        CacheBackendLifecycle,
      ],
      exports: [CACHE_OPTIONS, CACHE_BACKEND, CacheService],
    };
  }

  static forRootAsync(options: {
    imports?: DynamicModule['imports'];
    inject?: unknown[];
    useFactory: (
      ...args: unknown[]
    ) => CacheModuleOptions | Promise<CacheModuleOptions>;
  }): DynamicModule {
    const optionsProvider: Provider = {
      provide: CACHE_OPTIONS,
      useFactory: async (...args: unknown[]) => {
        const resolved = await options.useFactory(...args);
        const keyPrefix: string =
          resolved.keyPrefix ??
          DEFAULT_CACHE_OPTIONS.keyPrefix ??
          DEFAULT_CACHE_KEY_PREFIX;
        return {
          ...DEFAULT_CACHE_OPTIONS,
          ...resolved,
          keyPrefix,
        } satisfies CacheModuleOptions;
      },
      inject: (options.inject ?? []) as never[],
    };

    return {
      module: CacheModule,
      imports: [...(options.imports ?? [])],
      providers: [
        optionsProvider,
        this.createBackendProvider(),
        this.createLoaderLockProvider(),
        CacheService,
        CacheBackendLifecycle,
      ],
      exports: [CACHE_OPTIONS, CACHE_BACKEND, CacheService],
    };
  }

  private static createLoaderLockProvider(): Provider {
    return {
      provide: CACHE_LOADER_LOCK,
      useFactory: (backend: CacheBackend) => {
        if (backend instanceof RedisCacheBackend) {
          return new RedisCacheLoaderLock(backend.getRedis());
        }
        return undefined;
      },
      inject: [CACHE_BACKEND],
    };
  }

  private static createBackendProvider(): Provider {
    return {
      provide: CACHE_BACKEND,
      useFactory: (
        cacheOptions: CacheModuleOptions,
        configService: ConfigService,
      ) => {
        if (cacheOptions.storage === CacheStorage.Redis) {
          const logger = new Logger('CacheRedis');
          const redis = new Redis({
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
            lazyConnect: true,
            maxRetriesPerRequest: 1,
          });
          redis.connect().catch((err: unknown) => {
            logger.error(
              `Redis cache connect failed: ${err instanceof Error ? err.message : err}`,
            );
          });
          return new RedisCacheBackend(redis);
        }
        return new MemoryCacheBackend();
      },
      inject: [CACHE_OPTIONS, ConfigService],
    };
  }
}
