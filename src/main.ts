import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { WinstonModule } from 'nest-winston';
import { winstonConfig } from './common/logger/logger.config';
import helmet from '@fastify/helmet';

async function bootstrap() {
  const fastifyAdapter = new FastifyAdapter({
    logger: false, // Disable default Fastify logger to use Winston
    ajv: {
      customOptions: {
        removeAdditional: true,  // Remove properties not in schema
        coerceTypes: true,       // Auto-convert types (e.g., "123" -> 123)
        useDefaults: true,       // Use default values from schema
        allErrors: false,        // Stop at first error for better performance
      },
    },
  });
  
  // Register helmet for security headers
  await fastifyAdapter.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
        scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
      },
    },
  });

  const app = await NestFactory.create(
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

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();