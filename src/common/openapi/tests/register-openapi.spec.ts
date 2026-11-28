import { Controller, Get } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  buildOpenApiDocument,
  OPENAPI_JSON_PATH,
  registerOpenApiEndpoint,
} from '../register-openapi';

@Controller('health')
class StubHealthController {
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}

describe('registerOpenApiEndpoint', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StubHealthController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves a valid OpenAPI 3 document at /openapi.json when enabled', async () => {
    const isRegistered = registerOpenApiEndpoint(app, { NODE_ENV: 'test' });
    expect(isRegistered).toBe(true);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({
      method: 'GET',
      url: OPENAPI_JSON_PATH,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.openapi).toMatch(/^3\./);
    expect(body.info?.title).toBe('NestJS Backend Boilerplate API');
    expect(body.paths['/health/live']).toBeDefined();
    expect(body.paths['/health/live'].get.responses['400']).toBeDefined();
    expect(body.paths['/health/live'].get.responses['401']).toBeDefined();
    expect(body.paths['/health/live'].get.responses['429']).toBeDefined();
    expect(body.components?.securitySchemes?.bearer).toBeDefined();
  });

  it('documents example jobs echo when EXAMPLE_JOBS_API_ENABLED=true', async () => {
    const isRegistered = registerOpenApiEndpoint(app, {
      NODE_ENV: 'test',
      EXAMPLE_JOBS_API_ENABLED: 'true',
    });
    expect(isRegistered).toBe(true);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({
      method: 'GET',
      url: OPENAPI_JSON_PATH,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.paths['/example/jobs/echo']?.post).toBeDefined();
    expect(body.paths['/example/jobs/echo'].post.security).toEqual([
      { bearer: [] },
    ]);
  });

  it('omits example jobs when EXAMPLE_JOBS_API_ENABLED=false in production', async () => {
    await app.init();
    const document = buildOpenApiDocument(app, {
      NODE_ENV: 'production',
      ENABLE_OPENAPI: 'true',
      EXAMPLE_JOBS_API_ENABLED: 'false',
    });
    expect(document.paths?.['/example/jobs/echo']).toBeUndefined();
  });

  it('includes job enqueue schema and error responses in generated OpenAPI', async () => {
    await app.init();
    const document = buildOpenApiDocument(app, {
      NODE_ENV: 'test',
      EXAMPLE_JOBS_API_ENABLED: 'true',
    });
    const post = document.paths?.['/example/jobs/echo']?.post;
    expect(post?.tags).toEqual(['example-jobs']);
    expect(post?.summary).toBe('Enqueue a demo echo background job');
    const schema = post?.requestBody?.content?.['application/json']?.schema as {
      required?: string[];
      properties?: Record<string, { type?: string }>;
    };
    expect(schema?.required).toEqual(['message']);
    expect(schema?.properties?.message).toEqual({ type: 'string' });
    expect(schema?.properties?.dedupeKey).toEqual({ type: 'string' });
    expect(post?.responses?.['200']?.description).toBe('Job enqueue result');
    expect(post?.responses?.['401']).toBeDefined();
    expect(post?.responses?.['429']).toBeDefined();
  });

  it('documents example jobs in development when the explicit flag is unset', async () => {
    await app.init();
    const document = buildOpenApiDocument(app, { NODE_ENV: 'development' });
    expect(document.paths?.['/example/jobs/echo']?.post).toBeDefined();
  });

  it('does not register /openapi.json in production by default', async () => {
    const isRegistered = registerOpenApiEndpoint(app, {
      NODE_ENV: 'production',
    });
    expect(isRegistered).toBe(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({
      method: 'GET',
      url: OPENAPI_JSON_PATH,
    });

    expect(response.statusCode).toBe(404);
  });
});
