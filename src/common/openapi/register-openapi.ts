import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { isOpenApiEnabled } from '@/common/config/is-openapi-enabled';

export const OPENAPI_JSON_PATH = '/openapi.json';

export function buildOpenApiDocument(
  app: NestFastifyApplication,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('NestJS Backend Boilerplate API')
    .setDescription('REST API OpenAPI specification')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function registerOpenApiEndpoint(
  app: NestFastifyApplication,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isOpenApiEnabled(env)) {
    return false;
  }

  const document = buildOpenApiDocument(app);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.get(OPENAPI_JSON_PATH, (_req, reply) => {
    return reply.type('application/json').send(document);
  });
  return true;
}
