import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import * as depthLimit from 'graphql-depth-limit';
import { HealthModule } from './health/health.module';
import { RedisModule } from './common/redis/redis.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { winstonConfig } from './core/logger/logger.config';
import { LoggerMiddleware } from './core/logger/logger.middleware';
import { TracingInterceptor } from './core/logger/tracing.interceptor';
import { LoggingInterceptor } from './core/logger/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { GqlThrottlerGuard } from './common/guards/throttler.guard';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CacheModule, CacheStorage } from './core/cache';
import {
  RateLimiterModule,
  RateLimitGuard,
  RateLimitStorage,
  RateLimitAlgorithm,
  RateLimitIdentifier,
  GuestIdMiddleware,
} from './core/rate-limiter';
import { ComplexityPlugin } from './common/plugins/complexity.plugin';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
        lazyConnection: true, // Do not block startup if MongoDB is down; /health returns 503
      }),
      inject: [ConfigService],
    }),
    HealthModule,
    RedisModule,
    AuthModule,
    CategoriesModule,
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
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: ['./**/*.graphql'],
      context: ({ request, reply }) => ({ req: request, res: reply }),
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
      provide: APP_GUARD,
      useClass: GqlJwtAuthGuard,
    },
    {
      // Runs after JWT so UserId policies can read req.user on authenticated routes.
      provide: APP_GUARD,
      useClass: RateLimitGuard,
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
      .apply(LoggerMiddleware, GuestIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
