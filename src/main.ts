import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { WinstonModule } from 'nest-winston';
import { winstonConfig } from './core/logger/logger.config';
import {
  registerGracefulShutdown,
  ShutdownState,
} from './core/shutdown';
import { parseTrustProxy } from './country-access';
import helmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import mongoose from 'mongoose';

const logger = new Logger('UnhandledRejection');

const DEFAULT_SHUTDOWN_DRAIN_MS = 10_000;
const DEFAULT_SHUTDOWN_FORCE_MS = 5_000;

function parseNonNegativeInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function bootstrap() {
  // TRUST_PROXY:
  // - Production (Client → ALB → EC2): set TRUST_PROXY=true so req.ip is the client IP.
  // - Explicit proxies: comma-separated IPs/CIDRs (e.g. 10.0.0.0/8,172.16.0.0/12).
  // - Local/dev (direct to Nest, no ALB): leave unset/false so clients cannot spoof X-Forwarded-For.
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

  const uploadMaxFiles =
    Number.parseInt(process.env.UPLOAD_MAX_FILES ?? '5', 10) || 5;
  const uploadMaxFileSize =
    Number.parseInt(process.env.UPLOAD_MAX_FILE_SIZE ?? '5000000', 10) ||
    5_000_000;
  const uploadMaxTotalSize =
    Number.parseInt(process.env.UPLOAD_MAX_TOTAL_SIZE ?? '20000000', 10) ||
    20_000_000;
  // Cap per-file so files * fileSize cannot exceed total before app checks run.
  const multipartFileSize = Math.min(
    uploadMaxFileSize,
    uploadMaxTotalSize,
  );

  const fastifyAdapter = new FastifyAdapter({
    logger: false, // Disable default Fastify logger to use Winston
    trustProxy,
    // Keep the default ~1MB JSON/GraphQL body cap. Upload totals are enforced
    // by @fastify/multipart limits + readMultipartFiles, not this global limit.
    // Allow app.close() to finish promptly during SIGTERM (drop keep-alive sockets).
    forceCloseConnections: true,
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
    hidePoweredBy: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`, 'https://sandbox.embed.apollographql.com'],
        styleSrc: [
          `'self'`,
          `'unsafe-inline'`,
          'https://fonts.googleapis.com',
          'https://sandbox.embed.apollographql.com',
        ],
        imgSrc: [
          `'self'`,
          'data:',
          'validator.swagger.io',
          'https://sandbox.embed.apollographql.com',
          'https://apollo-server-landing-page.cdn.apollographql.com',
        ],
        scriptSrc: [
          `'self'`,
          `https: 'unsafe-inline'`,
          'https://sandbox.embed.apollographql.com',
        ],
      },
    },
  });

  // Register fastify-cookie
  await fastifyAdapter.register(fastifyCookie as any, {
    secret: process.env.COOKIE_SECRET,
  });

  // Multi-file uploads (see UploadsModule). Limits enforced in validateUploadFiles
  // and again here so the parser cannot buffer more than max total size.
  await fastifyAdapter.register(multipart as any, {
    limits: {
      files: uploadMaxFiles,
      fileSize: multipartFileSize,
      fields: 10,
      parts: uploadMaxFiles + 10,
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter as any,
    {
      logger: WinstonModule.createLogger(winstonConfig),
    },
  );

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  });

  // Manual SIGTERM/SIGINT handlers (not enableShutdownHooks): mark readiness
  // 503 first, wait for ALB drain, then close so Nest lifecycle runs.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');

  registerGracefulShutdown(app, app.get(ShutdownState), {
    drainMs: parseNonNegativeInt(
      process.env.SHUTDOWN_DRAIN_MS,
      DEFAULT_SHUTDOWN_DRAIN_MS,
    ),
    forceMs: parseNonNegativeInt(
      process.env.SHUTDOWN_FORCE_MS,
      DEFAULT_SHUTDOWN_FORCE_MS,
    ),
    beforeClose: async () => {
      // Abort pending Mongo connect attempts so Nest mongoose teardown cannot hang.
      try {
        await mongoose.connection.destroy();
      } catch {
        // already closed / never opened
      }
    },
  });
}
// Prevent process exit on unhandled promise rejections (e.g. lazy Mongo connection failure).
// Exception filters only run for errors during HTTP requests; they cannot catch these.
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error(message, stack);
});
bootstrap();
