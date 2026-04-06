import {
  Module,
  MiddlewareConsumer,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { winstonConfig } from './common/logger/logger.config';
import { LoggerMiddleware } from './common/logger/logger.middleware';
import { TracingInterceptor } from './common/logger/tracing.interceptor';
import { LoggingInterceptor } from './common/logger/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { GqlThrottlerGuard } from './common/guards/throttler.guard';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
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
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
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
      useClass: GqlThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
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
      .apply(LoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
