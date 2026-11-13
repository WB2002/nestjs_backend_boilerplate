import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpClient, HttpClientModule } from '@/core/http-client';
import { ConformanceHttpClientService } from '../conformance-http-client.service';

describe('ConformanceHttpClientService', () => {
  const previousAllowPrivateUrls = process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS;
  let testingModule: TestingModule;
  let service: ConformanceHttpClientService;
  let httpClient: HttpClient;
  let server: http.Server;
  let baseUrl: string;

  let upstreamHandler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => void;

  beforeAll(async () => {
    process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS = 'true';

    server = http.createServer((req, res) => {
      upstreamHandler(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (previousAllowPrivateUrls === undefined) {
      delete process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS;
    } else {
      process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS = previousAllowPrivateUrls;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      imports: [HttpClientModule],
      providers: [ConformanceHttpClientService],
    }).compile();

    service = testingModule.get<ConformanceHttpClientService>(
      ConformanceHttpClientService,
    );
    httpClient = testingModule.get<HttpClient>(HttpClient);
  });

  afterEach(async () => {
    await httpClient.close(100);
    await testingModule.close();
  });

  it('returns upstream body', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };

    const serviceResponse = await service.execute({
      clientKind: 'internal',
      clientName: 'test-upstream-body',
      targetUrl: `${baseUrl}/ok`,
    });

    expect(serviceResponse).toEqual({
      upstreamStatus: 200,
      upstreamBody: { ok: true },
    });
  });

  it('retries 503 then succeeds', async () => {
    let requestCount = 0;
    upstreamHandler = (_req, res) => {
      requestCount++;
      if (requestCount <= 2) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'temporarily unavailable' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    };

    const serviceResponse = await service.execute({
      clientKind: 'internal',
      clientName: 'test-retry-success',
      targetUrl: `${baseUrl}/retry`,
      maxRetries: 2,
      baseDelayMs: 1,
    });

    expect(serviceResponse).toEqual({
      upstreamStatus: 200,
      upstreamBody: { ok: true },
    });
    expect(requestCount).toBe(3);
  });

  it('maps open circuit to 503 and reuses client per clientName', async () => {
    let requestCount = 0;
    upstreamHandler = (_req, res) => {
      requestCount++;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal server error' }));
    };

    const requestPayload = {
      clientKind: 'internal' as const,
      clientName: 'test-circuit-breaker-shared',
      targetUrl: `${baseUrl}/circuit`,
      circuitBreakerFailureThreshold: 2,
      circuitBreakerResetTimeoutMs: 10_000,
    };

    // First call -> fails with 500, mapped to BadGatewayException (502)
    await expect(service.execute(requestPayload)).rejects.toThrow(
      BadGatewayException,
    );
    expect(requestCount).toBe(1);

    // Second call -> fails with 500, trips breaker to OPEN
    await expect(service.execute(requestPayload)).rejects.toThrow(
      BadGatewayException,
    );
    expect(requestCount).toBe(2);

    // Third call -> circuit is OPEN, maps to ServiceUnavailableException (503)
    let caughtException: unknown;
    try {
      await service.execute(requestPayload);
    } catch (caughtError: unknown) {
      caughtException = caughtError;
    }

    expect(caughtException).toBeInstanceOf(ServiceUnavailableException);
    const serviceUnavailable = caughtException as ServiceUnavailableException;
    expect(serviceUnavailable.getStatus()).toBe(503);
    expect(serviceUnavailable.getResponse()).toMatchObject({
      errorName: 'CircuitOpenError',
      errorMessage: expect.any(String),
    });

    // Server was NOT called a 3rd time because breaker blocked it
    expect(requestCount).toBe(2);
  });

  it('maps timeout to 504 GatewayTimeoutException', async () => {
    upstreamHandler = (_req, _res) => {
      // Deliberately hang to trigger timeout
    };

    let caughtException: unknown;
    try {
      await service.execute({
        clientKind: 'external',
        clientName: 'test-timeout',
        targetUrl: `${baseUrl}/timeout`,
        timeoutMs: 50,
      });
    } catch (caughtError: unknown) {
      caughtException = caughtError;
    }

    expect(caughtException).toBeInstanceOf(GatewayTimeoutException);
    const timeoutException = caughtException as GatewayTimeoutException;
    expect(timeoutException.getStatus()).toBe(504);
    expect(timeoutException.getResponse()).toMatchObject({
      errorName: 'TimeoutError',
      errorMessage: expect.any(String),
    });
  });

  it('maps exhausted retries to 502 BadGatewayException', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed' }));
    };

    let caughtException: unknown;
    try {
      await service.execute({
        clientKind: 'internal',
        clientName: 'test-exhausted',
        targetUrl: `${baseUrl}/exhausted`,
        maxRetries: 1,
        baseDelayMs: 1,
      });
    } catch (caughtError: unknown) {
      caughtException = caughtError;
    }

    expect(caughtException).toBeInstanceOf(BadGatewayException);
    const badGatewayException = caughtException as BadGatewayException;
    expect(badGatewayException.getStatus()).toBe(502);
    expect(badGatewayException.getResponse()).toMatchObject({
      errorName: 'RetryExhaustedError',
      errorMessage: expect.any(String),
    });
  });

  it('maps non-retryable 500 HttpError to 502 with statusCode', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'crash' }));
    };

    let caughtException: unknown;
    try {
      await service.execute({
        clientKind: 'internal',
        clientName: 'test-http-error',
        targetUrl: `${baseUrl}/http-error`,
      });
    } catch (caughtError: unknown) {
      caughtException = caughtError;
    }

    expect(caughtException).toBeInstanceOf(BadGatewayException);
    const badGatewayException = caughtException as BadGatewayException;
    expect(badGatewayException.getStatus()).toBe(502);
    expect(badGatewayException.getResponse()).toEqual({
      errorName: 'HttpError',
      errorMessage: expect.any(String),
      statusCode: 500,
    });
  });

  it('evicts oldest client entry when client cache exceeds 50 entries', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };

    for (let index = 0; index < 52; index++) {
      await service.execute({
        clientKind: 'internal',
        clientName: `client-lru-${index}`,
        targetUrl: `${baseUrl}/ok`,
      });
    }

    // Cache should hold max 50 entries
    expect(service.getClientCacheSize()).toBe(50);
    // Oldest entries 0 and 1 were evicted
    expect(service.hasClientInCache('client-lru-0')).toBe(false);
    expect(service.hasClientInCache('client-lru-1')).toBe(false);
    // Newest entries are present
    expect(service.hasClientInCache('client-lru-50')).toBe(true);
    expect(service.hasClientInCache('client-lru-51')).toBe(true);
  });
});
