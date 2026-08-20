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
import depthLimit = require('graphql-depth-limit');
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
import { CacheModule, CacheStorage } from './core/cache';
import { ShutdownModule } from './core/shutdown';
import {
  RateLimiterModule,
  RateLimitGuard,
  RateLimitStorage,
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
import { UploadsModule } from './uploads/uploads.module';
import { CountryAccessModule, CountryAccessGuard } from './country-access';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ShutdownModule,
    MongooseModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
        lazyConnection: true, // Do not block startup if MongoDB is down; /health returns 503
        // Fail fast on connect/selection so health checks and shutdown never hang.
        serverSelectionTimeoutMS: 2_000,
        connectTimeoutMS: 2_000,
      }),
      inject: [ConfigService],
    }),
    HealthModule,
    RedisModule,
    HttpClientModule,
    AuthModule,
    CategoriesModule,
    UploadsModule,
    CountryAccessModule,
    WinstonModule.forRoot(winstonConfig),
    CacheModule.forRoot({ storage: CacheStorage.Memory }),
    RateLimiterModule.forRoot({
      storage: RateLimitStorage.Memory,
      algorithm: RateLimitAlgorithm.FixedWindowCounter,
      // Local HTTP needs secure:false so browsers store guest_id; production keeps Secure.
      guestCookie: {
        secure: process.env.NODE_ENV === 'production',
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
    }),
    RequestDeadlineModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
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
      .apply(LoggerMiddleware, GuestIdMiddleware, RequestDeadlineMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
