import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { ConformanceHttpClientController } from '../conformance-http-client.controller';
import { ConformanceHttpClientService } from '../conformance-http-client.service';
import { withConformanceHarnessGuardStub } from './conformance-harness-guard-test.provider';

describe('ConformanceHttpClientController (HTTP)', () => {
  let testingModule: TestingModule;
  let testApplication: NestFastifyApplication;
  let mockService: {
    execute: jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      execute: jest.fn().mockResolvedValue({
        upstreamStatus: 200,
        upstreamBody: { probed: true },
      }),
    };

    testingModule = await withConformanceHarnessGuardStub(
      Test.createTestingModule({
        controllers: [ConformanceHttpClientController],
        providers: [
          {
            provide: ConformanceHttpClientService,
            useValue: mockService,
          },
        ],
      }),
    ).compile();

    testApplication =
      testingModule.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
    testApplication.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await testApplication.init();
    await testApplication.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await testApplication.close();
  });

  it('POST /conformance/http-client returns 200 with upstream payload', async () => {
    const postResponse = await testApplication.inject({
      method: 'POST',
      url: '/conformance/http-client',
      payload: {
        clientKind: 'internal',
        clientName: 'probe-service',
        targetUrl: 'http://127.0.0.1:4010/probe',
      },
    });

    expect(postResponse.statusCode).toBe(200);
    expect(postResponse.json()).toEqual({
      upstreamStatus: 200,
      upstreamBody: { probed: true },
    });
    expect(mockService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        clientKind: 'internal',
        clientName: 'probe-service',
        targetUrl: 'http://127.0.0.1:4010/probe',
      }),
    );
  });

  it('rejects non-loopback targetUrl with 400', async () => {
    const postResponse = await testApplication.inject({
      method: 'POST',
      url: '/conformance/http-client',
      payload: {
        clientKind: 'internal',
        clientName: 'probe-service',
        targetUrl: 'https://evil.example.com/steal',
      },
    });

    expect(postResponse.statusCode).toBe(400);
    expect(postResponse.json()).toMatchObject({
      message: 'targetUrl must be http://127.0.0.1 or http://localhost',
    });
    expect(mockService.execute).not.toHaveBeenCalled();
  });

  it('rejects invalid clientName format with 400', async () => {
    const postResponse = await testApplication.inject({
      method: 'POST',
      url: '/conformance/http-client',
      payload: {
        clientKind: 'internal',
        clientName: 'INVALID_UPPERCASE!',
        targetUrl: 'http://127.0.0.1:4010/probe',
      },
    });

    expect(postResponse.statusCode).toBe(400);
    expect(mockService.execute).not.toHaveBeenCalled();
  });

  it('rejects invalid clientKind with 400', async () => {
    const postResponse = await testApplication.inject({
      method: 'POST',
      url: '/conformance/http-client',
      payload: {
        clientKind: 'unsupported-kind',
        clientName: 'probe-service',
        targetUrl: 'http://127.0.0.1:4010/probe',
      },
    });

    expect(postResponse.statusCode).toBe(400);
    expect(mockService.execute).not.toHaveBeenCalled();
  });

  it('rejects out-of-bounds maxRetries with 400', async () => {
    const postResponse = await testApplication.inject({
      method: 'POST',
      url: '/conformance/http-client',
      payload: {
        clientKind: 'internal',
        clientName: 'probe-service',
        targetUrl: 'http://127.0.0.1:4010/probe',
        maxRetries: 99,
      },
    });

    expect(postResponse.statusCode).toBe(400);
    expect(mockService.execute).not.toHaveBeenCalled();
  });
});
