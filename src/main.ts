import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { WinstonModule } from 'nest-winston';
import { winstonConfig } from './core/logger/logger.config';
import helmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';

const logger = new Logger('UnhandledRejection');

async function bootstrap() {
  // TRUST_PROXY:
  // - Production (Client → ALB → EC2): set TRUST_PROXY=true so req.ip is the client IP.
  // - Local/dev (direct to Nest, no ALB): leave unset/false so clients cannot spoof X-Forwarded-For.
  const trustProxy = process.env.TRUST_PROXY === 'true';

  const fastifyAdapter = new FastifyAdapter({
    logger: false, // Disable default Fastify logger to use Winston
    trustProxy,
    ajv: {
      customOptions: {
        removeAdditional: true, // Remove properties not in schema
        coerceTypes: true, // Auto-convert types (e.g., "123" -> 123)
        useDefaults: true, // Use default values from schema
        allErrors: false, // Stop at first error for better performance
      },
    },
  });

  // Register helmet for security headers
  await fastifyAdapter.register(helmet as any, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
        scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
      },
    },
  });

  // Register fastify-cookie
  await fastifyAdapter.register(fastifyCookie as any, {
    secret: process.env.COOKIE_SECRET,
  });

  const app = await NestFactory.create(AppModule, fastifyAdapter as any, {
    logger: WinstonModule.createLogger(winstonConfig),
  });

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
// Prevent process exit on unhandled promise rejections (e.g. lazy Mongo connection failure).
// Exception filters only run for errors during HTTP requests; they cannot catch these.
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error(message, stack);
});
bootstrap();
