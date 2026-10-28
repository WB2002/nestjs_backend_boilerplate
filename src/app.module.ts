import {
  Module,
  MiddlewareConsumer,
  NestModule,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER, APP_PIPE } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import depthLimit = require('graphql-depth-limit'); // eslint-disable-line @typescript-eslint/no-require-imports
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HealthModule } from './health/health.module';
import { RedisModule } from './common/redis/redis.module';
import { HttpClientModule } from './core/http-client';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { winstonConfig } from './core/logger/logger.config';
import { LoggerMiddleware } from './core/logger/logger.middleware';
import { TracingInterceptor } from './core/logger/tracing.interceptor';
import { LoggingInterceptor } from './core/logger/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { parseCacheModuleOptions } from './common/config/parse-cache-module-options';
import { CacheModule } from './core/cache';
import { ShutdownModule } from './core/shutdown';
import {
  RateLimiterModule,
  RateLimitGuard,
  RateLimitAlgorithm,
  RateLimitIdentifier,
  GuestIdMiddleware,
} from './core/rate-limiter';
import {
  RequestDeadlineModule,
  RequestDeadlineMiddleware,
  RequestDeadlineInterceptor,
  parsePositiveTimeoutMs,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MAX_MS,
} from './core/request-deadline';
import { ComplexityPlugin } from './common/plugins/complexity.plugin';
import { SanitizationPipe } from './common/sanitization';
import { validateEnv } from './common/config';
import { isWebSocketEnabled } from './common/config/load-env-file';
import { isBackgroundJobsEnabled } from './common/config/is-background-jobs-enabled';
import { BackgroundJobsModule } from './core/background-jobs';
import { ExampleRealtimeModule } from './example/example-realtime.module';
import {
  configServiceFromFactoryArgs,
  resolveCacheStorageFromConfig,
  resolveRateLimitStorageFromConfig,
} from './common/config/resolve-coordination-storage';
import { UploadsModule } from './uploads/uploads.module';
import { CountryAccessModule, CountryAccessGuard } from './country-access';
import { CaptchaModule } from './core/captcha';
import { NotificationModule } from './core/notification';
import { ExampleModule } from './example/example.module';
import { ExampleJobsModule } from './example/example-jobs.module';
import { FeatureFlagModule } from './feature-flag';
import {
  InboundPriorityBulkheadGuard,
  OverloadModule,
} from './core/overload';
import {
  CsrfModule,
  CsrfMiddleware,
  DEFAULT_CSRF_EXEMPT_PATHS,
} from './core/csrf';
import { parseCsvPaths } from './core/csrf/helpers/parse-csv-paths';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    ShutdownModule,
    OverloadModule.forRoot(),
    MongooseModule.forRootAsync({
      useFactory: (...args: unknown[]) => {
        const configService = configServiceFromFactoryArgs(args);
        return {
          uri: configService.get<string>('MONGO_URI') as string,
          lazyConnection: true, // Do not block startup if MongoDB is down; /health returns 503
          // Fail fast on connect/selection so health checks and shutdown never hang.
          serverSelectionTimeoutMS: 2_000,
          connectTimeoutMS: 2_000,
        };
      },
      inject: [ConfigService],
    }),
    HealthModule,
    RedisModule,
    HttpClientModule,
    CaptchaModule,
    NotificationModule,
    AuthModule,
    CategoriesModule,
    UploadsModule,
    CountryAccessModule,
    ExampleModule,
    ...(isWebSocketEnabled() ? [ExampleRealtimeModule] : []),
    ...(isBackgroundJobsEnabled()
      ? [
          BackgroundJobsModule.forRootAsync({
            registerWorker: process.env.BACKGROUND_WORKER_ENABLED === 'true',
          }),
          ExampleJobsModule,
        ]
      : []),
    FeatureFlagModule,
    WinstonModule.forRoot(winstonConfig),
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (...args: unknown[]) => {
        const configService = configServiceFromFactoryArgs(args);
        return {
          storage: resolveCacheStorageFromConfig(configService),
          ...parseCacheModuleOptions(configService),
        };
      },
    }),
    RateLimiterModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (...args: unknown[]) => {
        const configService = configServiceFromFactoryArgs(args);
        return {
          storage: resolveRateLimitStorageFromConfig(configService),
          algorithm: RateLimitAlgorithm.FixedWindowCounter,
          guestCookie: {
            secure: configService.get<string>('NODE_ENV') === 'production',
          },
          methods: [
            {
              name: 'global-ip',
              identifier: RateLimitIdentifier.Ip,
              duration: 60_000,
              limit: 10,
              cost: 1,
              keyScope: 'global',
            },
          ],
        };
      },
    }),
    RequestDeadlineModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (...args: unknown[]) => {
        const configService = configServiceFromFactoryArgs(args);
        const defaultTimeoutMs = parsePositiveTimeoutMs(
          configService.get('REQUEST_TIMEOUT_MS'),
          DEFAULT_REQUEST_TIMEOUT_MS,
        );
        const maxTimeoutMs = Math.max(
          defaultTimeoutMs,
          parsePositiveTimeoutMs(
            configService.get('REQUEST_TIMEOUT_MAX_MS'),
            DEFAULT_REQUEST_TIMEOUT_MAX_MS,
          ),
        );
        return { defaultTimeoutMs, maxTimeoutMs };
      },
    }),
    CsrfModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: unknown) => {
        const config = configService as ConfigService;
        return {
          enabled: config.get<string>('CSRF_ENABLED', 'true') !== 'false',
          exemptPaths: parseCsvPaths(
            config.get<string>('CSRF_EXEMPT_PATHS'),
            DEFAULT_CSRF_EXEMPT_PATHS,
          ),
        };
      },
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: ['./**/*.graphql'],
      context: ({
        request,
        reply,
      }: {
        request: FastifyRequest;
        reply: FastifyReply;
      }) => ({ req: request, res: reply }),
      definitions: {
        path: join(process.cwd(), 'src/graphql.ts'),
        outputAs: 'class',
      },
      playground: true,
      validationRules: [depthLimit(10)],
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      // Sanitize before class-validator so @MinLength/@MaxLength see cleaned values.
      provide: APP_PIPE,
      useClass: SanitizationPipe,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    },
    {
      provide: APP_GUARD,
      useClass: InboundPriorityBulkheadGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      // Coarse country filter after auth, before rate limiting.
      provide: APP_GUARD,
      useClass: CountryAccessGuard,
    },
    {
      // Runs after JWT so UserId policies can read req.user on authenticated routes.
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestDeadlineInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TracingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    ComplexityPlugin,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        LoggerMiddleware,
        GuestIdMiddleware,
        CsrfMiddleware,
        RequestDeadlineMiddleware,
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
