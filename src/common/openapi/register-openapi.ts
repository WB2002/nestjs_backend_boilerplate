import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { isExampleJobsApiEnabled } from '@/common/config/is-example-jobs-api-enabled';
import { isOpenApiEnabled } from '@/common/config/is-openapi-enabled';

export const OPENAPI_JSON_PATH = '/openapi.json';

const STANDARD_ERROR_RESPONSES: Record<string, { description: string }> = {
  '400': { description: 'Bad Request' },
  '401': { description: 'Unauthorized' },
  '403': { description: 'Forbidden' },
  '404': { description: 'Not Found' },
  '409': { description: 'Conflict' },
  '415': { description: 'Unsupported Media Type' },
  '429': { description: 'Too Many Requests' },
};

const OPENAPI_HTTP_METHODS = new Set<string>([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
]);

function attachStandardErrorResponses(document: OpenAPIObject): OpenAPIObject {
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (
        !OPENAPI_HTTP_METHODS.has(method) ||
        !operation ||
        typeof operation !== 'object'
      ) {
        continue;
      }
      const typedOperation = operation as {
        responses?: Record<string, unknown>;
      };
      const existingResponses = typedOperation.responses ?? {};
      typedOperation.responses = {
        ...STANDARD_ERROR_RESPONSES,
        ...existingResponses,
      };
    }
  }
  return document;
}

function attachExampleJobsOpenApiPath(
  document: OpenAPIObject,
  env: NodeJS.ProcessEnv,
): OpenAPIObject {
  if (!isExampleJobsApiEnabled(env)) {
    return document;
  }

  const paths = document.paths ?? {};
  document.paths = {
    ...paths,
    '/example/jobs/echo': {
      post: {
        tags: ['example-jobs'],
        summary: 'Enqueue a demo echo background job',
        security: [{ bearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string' },
                  dedupeKey: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '200': { description: 'Job enqueue result' },
        },
      },
    },
  };
  return document;
}

export function buildOpenApiDocument(
  app: NestFastifyApplication,
  env: NodeJS.ProcessEnv = process.env,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('NestJS Backend Boilerplate API')
    .setDescription('REST API OpenAPI specification')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();

  const baseDocument = SwaggerModule.createDocument(app, config);
  const withExampleJobs = attachExampleJobsOpenApiPath(baseDocument, env);
  return attachStandardErrorResponses(withExampleJobs);
}

export function registerOpenApiEndpoint(
  app: NestFastifyApplication,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isOpenApiEnabled(env)) {
    return false;
  }

  const document = buildOpenApiDocument(app, env);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.get(OPENAPI_JSON_PATH, (_req, reply) => {
    return reply.type('application/json').send(document);
  });
  return true;
}
