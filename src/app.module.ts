import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { HealthModule } from './health/health.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { winstonConfig } from './core/logger/logger.config';
import { LoggerMiddleware } from './core/logger/logger.middleware';
import { TracingInterceptor } from './core/logger/tracing.interceptor';
import { LoggingInterceptor } from './core/logger/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import {
  RateLimiterModule,
  RateLimitGuard,
  RateLimitStorage,
  RateLimitAlgorithm,
  RateLimitIdentifier,
  GuestIdMiddleware,
} from './core/rate-limiter';

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
    AuthModule,
    WinstonModule.forRoot(winstonConfig),
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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware, GuestIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
