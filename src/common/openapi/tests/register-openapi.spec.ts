import { Controller, Get } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
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
