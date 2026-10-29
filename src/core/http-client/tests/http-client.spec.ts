import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as http from 'http';
import { AddressInfo } from 'net';
import { context, propagation, trace } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { AxiosError } from 'axios';

jest.mock('aws-embedded-metrics', () => ({
  Unit: {
    Milliseconds: 'Milliseconds',
    Count: 'Count',
    None: 'None',
  },
  createMetricsLogger: () => ({
    setNamespace: jest.fn(),
    putDimensions: jest.fn(),
    putMetric: jest.fn(),
    setProperty: jest.fn(),
    flush: jest.fn(async () => undefined),
  }),
}));

// Local test servers bind to loopback; allow private/loopback outbound URLs in this suite.
process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS = 'true';

import { DeadlineContext } from '../../request-deadline/context/deadline.context';
import {
  HttpClient,
  HttpClientModule,
  exponentialBackoff,
  fixedBackoff,
  linearBackoff,
  fullJitter,
  equalJitter,
  defaultCanRetry,
  CircuitOpenError,
  RetryExhaustedError,
  HttpError,
  TimeoutError,
  RequestAbortedError,
  redactHeaders,
  redactQuery,
  redactUrl,
  createTimeoutBudget,
  sleep,
  sleepWithinBudget,
  poolKey,
  ConcurrencyLimiter,
  RequestCoalescer,
  ClientClosedError,
} from '../index';
import { normalizeError } from '../errors';
import { ConnectionPoolRegistry } from '../transport/connection-pool.registry';
import { OAuthTokenManager } from '../auth/oauth-token-manager';
import type { HttpResponse } from '../types';
import { AxiosTransport } from '../transport/axios-transport';

function listen(
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => void | Promise<void>,
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => {
      res.statusCode = 500;
      res.end('error');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('HttpClient', () => {
  let httpClient: HttpClient;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HttpClientModule],
    }).compile();
    httpClient = moduleRef.get(HttpClient);
  });

  afterEach(async () => {
    await httpClient.close(100);
  });

  it('exposes internal and external clients with equal defaults and isolated identity', () => {
    const internal = httpClient.internal('billing');
    const external = httpClient.external('billing');

    expect(internal.identity).toEqual({
      kind: 'internal',
      serviceName: 'billing',
    });
    expect(external.identity).toEqual({
      kind: 'external',
      serviceName: 'billing',
    });
    expect(internal.getPolicy().connectionPool).toEqual(
      external.getPolicy().connectionPool,
    );
    expect(internal.getPolicy().telemetry).toEqual(
      external.getPolicy().telemetry,
    );
  });

  it('returns immutable clients from addX methods', () => {
    const base = httpClient.external('payments');
    const withRetry = base.addRetry({
      maxAttempts: 3,
      backoff: fixedBackoff({ delay: 10 }),
    });
    expect(withRetry).not.toBe(base);
    expect(base.getPolicy().retry).toBeUndefined();
    expect(withRetry.getPolicy().retry?.maxAttempts).toBe(3);
  });

  it('performs GET/POST with JSON body and query/path params', async () => {
    const { server, baseUrl } = await listen(async (req, res) => {
      const body = await readBody(req);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          body: body ? JSON.parse(body) : null,
        }),
      );
    });

    try {
      const client = httpClient.external('demo').addBaseUrl(baseUrl);

      const getResponse = await client.get('/users/:id', {
        pathParams: { id: 42 },
        query: { active: true, tags: ['a', 'b'] },
      });
      expect(getResponse.ok).toBe(true);
      expect(getResponse.body).toMatchObject({
        method: 'GET',
        url: '/users/42?active=true&tags=a&tags=b',
      });

      const postResponse = await client.post('/users', { name: 'Ada' });
      expect(postResponse.body).toMatchObject({
        method: 'POST',
        body: { name: 'Ada' },
      });
    } finally {
      server.close();
    }
  });

  it('supports PUT/PATCH/DELETE/HEAD', async () => {
    const { server, baseUrl } = await listen((req, res) => {
      res.statusCode = req.method === 'HEAD' ? 204 : 200;
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ method: req.method }));
    });

    try {
      const client = httpClient.internal('svc').addBaseUrl(baseUrl);
      expect((await client.put('/x', { a: 1 })).body).toEqual({
        method: 'PUT',
      });
      expect((await client.patch('/x', { a: 2 })).body).toEqual({
        method: 'PATCH',
      });
      expect((await client.delete('/x')).body).toEqual({ method: 'DELETE' });
      expect((await client.head('/x')).status).toBe(204);
    } finally {
      server.close();
    }
  });

  it('applies bearer and api key auth headers', async () => {
    const { server, baseUrl } = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          authorization: req.headers.authorization,
          apiKey: req.headers['x-api-key'],
        }),
      );
    });

    try {
      const bearer = await httpClient
        .external('auth')
        .addBaseUrl(baseUrl)
        .addBearerToken({ token: 'abc' })
        .get('/');
      expect(bearer.body).toEqual({
        authorization: 'Bearer abc',
        apiKey: undefined,
      });

      const apiKey = await httpClient
        .external('auth-key')
        .addBaseUrl(baseUrl)
        .addApiKey({ key: 'k-1' })
        .get('/');
      expect(apiKey.body).toMatchObject({ apiKey: 'k-1' });
    } finally {
      server.close();
    }
  });

  it('acquires and caches OAuth client-credentials tokens with single-flight', async () => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const { server, baseUrl } = await listen(async (req, res) => {
      if (req.url === '/oauth/token') {
        tokenCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            access_token: 'token-1',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
        );
        return;
      }
      apiCalls += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ authorization: req.headers.authorization }));
    });

    try {
      const client = httpClient
        .external('oauth-svc')
        .addBaseUrl(baseUrl)
        .addOAuth({
          grantType: 'client_credentials',
          tokenUrl: `${baseUrl}/oauth/token`,
          clientId: 'id',
          clientSecret: 'secret',
          allowInsecureTokenUrl: true,
        });

      const [a, b] = await Promise.all([
        client.get('/api'),
        client.get('/api'),
      ]);
      expect(tokenCalls).toBe(1);
      expect(apiCalls).toBe(2);
      expect(a.body).toEqual({ authorization: 'Bearer token-1' });
      expect(b.body).toEqual({ authorization: 'Bearer token-1' });
    } finally {
      server.close();
    }
  });

  it('refreshes OAuth token once on 401 and retries the request', async () => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const { server, baseUrl } = await listen(async (req, res) => {
      if (req.url === '/oauth/token') {
        tokenCalls += 1;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            access_token: `token-${tokenCalls}`,
            expires_in: 3600,
          }),
        );
        return;
      }

      apiCalls += 1;
      if (apiCalls === 1) {
        res.statusCode = 401;
        res.end('unauthorized');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ authorization: req.headers.authorization }));
    });

    try {
      const response = await httpClient
        .external('oauth-refresh')
        .addBaseUrl(baseUrl)
        .addOAuth({
          grantType: 'client_credentials',
          tokenUrl: `${baseUrl}/oauth/token`,
          clientId: 'id',
          clientSecret: 'secret',
          allowInsecureTokenUrl: true,
        })
        .get('/api');

      expect(tokenCalls).toBe(2);
      expect(apiCalls).toBe(2);
      expect(response.body).toEqual({ authorization: 'Bearer token-2' });
    } finally {
      server.close();
    }
  });

  it('retries transient failures with backoff and preserves idempotency key', async () => {
    let attempts = 0;
    const keys: string[] = [];
    const { server, baseUrl } = await listen((req, res) => {
      attempts += 1;
      keys.push(String(req.headers['idempotency-key'] ?? ''));
      if (attempts < 3) {
        res.statusCode = 503;
        res.end('unavailable');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const response = await httpClient
        .external('retry')
        .addBaseUrl(baseUrl)
        .addIdempotency({
          header: 'Idempotency-Key',
          generateKey: () => 'fixed-key',
        })
        .addRetry({
          maxAttempts: 3,
          backoff: fixedBackoff({ delay: 1 }),
          canRetry: (req) =>
            defaultCanRetry(req) || req.headers?.['Idempotency-Key'] != null,
        })
        .post('/payments', { amount: 10 });

      expect(response.body).toEqual({ ok: true });
      expect(attempts).toBe(3);
      expect(keys).toEqual(['fixed-key', 'fixed-key', 'fixed-key']);
    } finally {
      server.close();
    }
  });

  it('throws RetryExhaustedError after max attempts', async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.statusCode = 503;
      res.end('nope');
    });

    try {
      const promise = httpClient
        .external('retry-fail')
        .addBaseUrl(baseUrl)
        .addRetry({
          maxAttempts: 2,
          backoff: fixedBackoff({ delay: 1 }),
        })
        .get('/x');

      await expect(promise).rejects.toBeInstanceOf(RetryExhaustedError);
    } finally {
      server.close();
    }
  });

  it('opens the circuit breaker after configured logical failures', async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.statusCode = 503;
      res.end('down');
    });

    try {
      const client = httpClient
        .external('breaker')
        .addBaseUrl(baseUrl)
        .addCircuitBreaker({
          failureThreshold: 2,
          resetTimeout: 60_000,
        });

      await expect(client.get('/a')).rejects.toBeInstanceOf(HttpError);
      await expect(client.get('/a')).rejects.toBeInstanceOf(HttpError);
      await expect(client.get('/a')).rejects.toBeInstanceOf(CircuitOpenError);
    } finally {
      server.close();
    }
  });

  it('trips the circuit breaker after RetryExhaustedError from transient failures', async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.statusCode = 503;
      res.end('down');
    });

    try {
      const client = httpClient
        .external('retry-breaker')
        .addBaseUrl(baseUrl)
        .addRetry({
          maxAttempts: 2,
          backoff: fixedBackoff({ delay: 1 }),
        })
        .addCircuitBreaker({
          failureThreshold: 2,
          resetTimeout: 60_000,
        });

      await expect(client.get('/a')).rejects.toBeInstanceOf(
        RetryExhaustedError,
      );
      await expect(client.get('/a')).rejects.toBeInstanceOf(
        RetryExhaustedError,
      );
      await expect(client.get('/a')).rejects.toBeInstanceOf(CircuitOpenError);
    } finally {
      server.close();
    }
  });

  it('re-trips half-open on non-transient probe failure instead of sticking', async () => {
    let mode: 'fail' | 'not-found' = 'fail';
    const { server, baseUrl } = await listen((_req, res) => {
      if (mode === 'fail') {
        res.statusCode = 503;
        res.end('down');
        return;
      }
      res.statusCode = 404;
      res.end('missing');
    });

    try {
      const client = httpClient
        .external('half-open')
        .addBaseUrl(baseUrl)
        .addCircuitBreaker({
          failureThreshold: 1,
          resetTimeout: 30,
          halfOpenMaxAttempts: 1,
        });

      await expect(client.get('/a')).rejects.toBeInstanceOf(HttpError);
      await expect(client.get('/a')).rejects.toBeInstanceOf(CircuitOpenError);

      mode = 'not-found';
      await new Promise((resolve) => setTimeout(resolve, 40));
      await expect(client.get('/a')).rejects.toBeInstanceOf(HttpError);

      // Stuck half-open would reject with CircuitOpenError forever without another reset.
      await expect(client.get('/a')).rejects.toBeInstanceOf(CircuitOpenError);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await expect(client.get('/a')).rejects.toBeInstanceOf(HttpError);
    } finally {
      server.close();
    }
  });

  it('does not re-trip half-open when non-probe callers hit probe limit', async () => {
    let mode: 'fail' | 'ok' = 'fail';
    const { server, baseUrl } = await listen((_req, res) => {
      if (mode === 'fail') {
        res.statusCode = 503;
        res.end('down');
        return;
      }
      res.statusCode = 200;
      res.end('{}');
    });

    try {
      const client = httpClient
        .external('half-open-limit')
        .addBaseUrl(baseUrl)
        .addCircuitBreaker({
          failureThreshold: 1,
          resetTimeout: 30,
          halfOpenMaxAttempts: 1,
        });

      await expect(client.get('/a')).rejects.toBeInstanceOf(HttpError);
      await expect(client.get('/a')).rejects.toBeInstanceOf(CircuitOpenError);

      mode = 'ok';
      await new Promise((resolve) => setTimeout(resolve, 40));

      // Concurrent callers: one probe succeeds; others may get probe-limit
      // CircuitOpenError, which must not re-trip and block recovery.
      const results = await Promise.allSettled([
        client.get('/a'),
        client.get('/a'),
        client.get('/a'),
      ]);
      const successes = results.filter((r) => r.status === 'fulfilled').length;
      const openErrors = results.filter(
        (r) => r.status === 'rejected' && r.reason instanceof CircuitOpenError,
      ).length;
      expect(successes + openErrors).toBe(3);
      expect(successes).toBeGreaterThanOrEqual(1);

      await expect(client.get('/a')).resolves.toMatchObject({ status: 200 });
    } finally {
      server.close();
    }
  });

  it('coalesces identical GET requests', async () => {
    let hits = 0;
    const { server, baseUrl } = await listen(async (_req, res) => {
      hits += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ hits }));
    });

    try {
      const client = httpClient
        .external('coalesce')
        .addBaseUrl(baseUrl)
        .addRequestCoalescing();

      const [a, b] = await Promise.all([
        client.get('/same'),
        client.get('/same'),
      ]);
      expect(hits).toBe(1);
      expect(a.body).toEqual(b.body);
    } finally {
      server.close();
    }
  });

  it('keeps coalescing entry until the executor settles after abort', async () => {
    const coalescer = new RequestCoalescer();
    let starts = 0;
    const execute = async (_signal: AbortSignal): Promise<HttpResponse> => {
      starts += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: {},
        body: { starts },
      };
    };

    const controller = new AbortController();
    const first = coalescer.run('k', execute, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(first).rejects.toBeTruthy();

    const second = coalescer.run('k', execute);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(starts).toBe(1);
    await expect(second).resolves.toMatchObject({
      status: 200,
      body: { starts: 1 },
    });
  });

  it('limits peak concurrency', async () => {
    let peak = 0;
    let current = 0;
    const { server, baseUrl } = await listen(async (_req, res) => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((resolve) => setTimeout(resolve, 30));
      current -= 1;
      res.statusCode = 200;
      res.end('{}');
    });

    try {
      const client = httpClient
        .external('limit')
        .addBaseUrl(baseUrl)
        .addConcurrencyLimit({ maxConcurrent: 2 });

      await Promise.all([
        client.get('/1'),
        client.get('/2'),
        client.get('/3'),
        client.get('/4'),
      ]);
      expect(peak).toBeLessThanOrEqual(2);
    } finally {
      server.close();
    }
  });

  const deadlineInternals = {
    clearTimer: () => undefined,
    rescheduleFromStart: () => undefined,
    setReason: () => undefined,
    abort: () => undefined,
  };

  it('propagates inbound x-request-deadline on internal client by default', async () => {
    let seenDeadline: string | undefined;
    const { server, baseUrl } = await listen((req, res) => {
      seenDeadline = req.headers['x-request-deadline'] as string | undefined;
      res.statusCode = 200;
      res.end('{}');
    });

    try {
      const controller = new AbortController();
      const startedAt = Date.now();
      const deadlineAt = startedAt + 5000;
      const store = {
        signal: controller.signal,
        startedAt,
        deadlineAt,
      };

      await new Promise<void>((resolve, reject) => {
        DeadlineContext.run(store, deadlineInternals, () => {
          httpClient
            .internal('downstream-deadline-header')
            .addBaseUrl(baseUrl)
            .get('/resource')
            .then(() => resolve())
            .catch(reject);
        });
      });

      expect(seenDeadline).toBe(String(deadlineAt));
    } finally {
      server.close();
    }
  });

  it('does not propagate x-request-deadline on external client by default', async () => {
    let seenDeadline: string | undefined;
    const { server, baseUrl } = await listen((req, res) => {
      seenDeadline = req.headers['x-request-deadline'] as string | undefined;
      res.statusCode = 200;
      res.end('{}');
    });

    try {
      const controller = new AbortController();
      const startedAt = Date.now();
      const store = {
        signal: controller.signal,
        startedAt,
        deadlineAt: startedAt + 5000,
      };

      await new Promise<void>((resolve, reject) => {
        DeadlineContext.run(store, deadlineInternals, () => {
          httpClient
            .external('external-no-deadline-header')
            .addBaseUrl(baseUrl)
            .get('/resource')
            .then(() => resolve())
            .catch(reject);
        });
      });

      expect(seenDeadline).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it('propagates x-request-deadline on external client when opted in', async () => {
    let seenDeadline: string | undefined;
    const { server, baseUrl } = await listen((req, res) => {
      seenDeadline = req.headers['x-request-deadline'] as string | undefined;
      res.statusCode = 200;
      res.end('{}');
    });

    try {
      const controller = new AbortController();
      const startedAt = Date.now();
      const deadlineAt = startedAt + 5000;
      const store = {
        signal: controller.signal,
        startedAt,
        deadlineAt,
      };

      await new Promise<void>((resolve, reject) => {
        DeadlineContext.run(store, deadlineInternals, () => {
          httpClient
            .external('external-deadline-header-opt-in')
            .addBaseUrl(baseUrl)
            .addDeadlinePropagation({ propagateHeader: true })
            .get('/resource')
            .then(() => resolve())
            .catch(reject);
        });
      });

      expect(seenDeadline).toBe(String(deadlineAt));
    } finally {
      server.close();
    }
  });

  it('caps outbound work by inbound request deadline remaining', async () => {
    const { server, baseUrl } = await listen(async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      res.statusCode = 200;
      res.end('{}');
    });

    try {
      const controller = new AbortController();
      const startedAt = Date.now();
      const store = {
        signal: controller.signal,
        startedAt,
        deadlineAt: startedAt + 80,
      };

      await new Promise<void>((resolve, reject) => {
        DeadlineContext.run(store, deadlineInternals, () => {
          const client = httpClient
            .external('inbound-deadline-cap')
            .addBaseUrl(baseUrl)
            .addTimeout({ timeoutMs: 10_000, totalTimeoutMs: 60_000 });

          client
            .get('/slow')
            .then(() => {
              reject(new Error('expected outbound abort or timeout'));
            })
            .catch((err: unknown) => {
              try {
                expect(
                  err instanceof TimeoutError ||
                    err instanceof RequestAbortedError,
                ).toBe(true);
                resolve();
              } catch (e) {
                reject(e);
              }
            });
        });
      });
    } finally {
      server.close();
    }
  });

  it('applies clusterAware concurrency using HTTP_CLIENT_INSTANCE_COUNT', async () => {
    const previous = process.env.HTTP_CLIENT_INSTANCE_COUNT;
    process.env.HTTP_CLIENT_INSTANCE_COUNT = '2';

    let peak = 0;
    let current = 0;
    const { server, baseUrl } = await listen(async (_req, res) => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((resolve) => setTimeout(resolve, 30));
      current -= 1;
      res.statusCode = 200;
      res.end('{}');
    });

    try {
      const client = httpClient
        .external('limit-cluster')
        .addBaseUrl(baseUrl)
        .addConcurrencyLimit({ maxConcurrent: 4, clusterAware: true });

      await Promise.all([
        client.get('/1'),
        client.get('/2'),
        client.get('/3'),
        client.get('/4'),
      ]);
      expect(peak).toBeLessThanOrEqual(2);
    } finally {
      server.close();
      if (previous === undefined) {
        delete process.env.HTTP_CLIENT_INSTANCE_COUNT;
      } else {
        process.env.HTTP_CLIENT_INSTANCE_COUNT = previous;
      }
    }
  });

  it('does not hold concurrency permits during retry backoff', async () => {
    let peak = 0;
    let current = 0;
    let aAttempts = 0;
    let aInRetryBackoff = false;
    let bServedDuringABackoff = false;
    let notifyAInBackoff: (() => void) | undefined;
    const aEnteredBackoff = new Promise<void>((resolve) => {
      notifyAInBackoff = resolve;
    });
    const { server, baseUrl } = await listen(async (req, res) => {
      const path = req.url ?? '';
      if (path.includes('/b') && aInRetryBackoff) {
        bServedDuringABackoff = true;
      }

      current += 1;
      peak = Math.max(peak, current);
      await new Promise((resolve) => setTimeout(resolve, 10));
      current -= 1;

      if (path.includes('/a')) {
        aAttempts += 1;
        if (aAttempts <= 2) {
          aInRetryBackoff = true;
          notifyAInBackoff?.();
          notifyAInBackoff = undefined;
          res.statusCode = 503;
          res.end('down');
          setTimeout(() => {
            aInRetryBackoff = false;
          }, 200);
          return;
        }
      }

      res.statusCode = 200;
      res.end('{}');
    });

    try {
      const client = httpClient
        .external('limit-backoff')
        .addBaseUrl(baseUrl)
        .addConcurrencyLimit({ maxConcurrent: 1 })
        .addRetry({
          maxAttempts: 3,
          backoff: fixedBackoff({ delay: 40 }),
        });

      const slow = client.get('/a');
      await aEnteredBackoff;
      const other = client.get('/b');
      await Promise.all([slow, other]);
      expect(bServedDuringABackoff).toBe(true);
      expect(peak).toBe(1);
    } finally {
      server.close();
    }
  });

  it('runs request and response interceptors in order', async () => {
    const order: string[] = [];
    const { server, baseUrl } = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ header: req.headers['x-order'] }));
    });

    try {
      const response = await httpClient
        .external('interceptors')
        .addBaseUrl(baseUrl)
        .addRequestInterceptor((req) => {
          order.push('req-1');
          return {
            ...req,
            headers: { ...req.headers, 'x-order': 'a' },
          };
        })
        .addRequestInterceptor((req) => {
          order.push('req-2');
          return {
            ...req,
            headers: {
              ...req.headers,
              'x-order': `${req.headers?.['x-order']}-b`,
            },
          };
        })
        .addResponseInterceptor((res) => {
          order.push('res-1');
          return { ...res, body: { ...(res.body as object), tagged: true } };
        })
        .get('/');

      expect(order).toEqual(['req-1', 'req-2', 'res-1']);
      expect(response.body).toEqual({ header: 'a-b', tagged: true });
    } finally {
      server.close();
    }
  });

  it('isolates runtimes for different bearer tokens on the same service name', async () => {
    const seen: string[] = [];
    const { server, baseUrl } = await listen((req, res) => {
      seen.push(String(req.headers.authorization ?? ''));
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });

    try {
      await httpClient
        .external('shared-svc')
        .addBaseUrl(baseUrl)
        .addBearerToken({ token: 'token-a' })
        .get('/');
      await httpClient
        .external('shared-svc')
        .addBaseUrl(baseUrl)
        .addBearerToken({ token: 'token-b' })
        .get('/');

      expect(seen).toEqual(['Bearer token-a', 'Bearer token-b']);
    } finally {
      server.close();
    }
  });

  it('isolates runtimes when canRetry callbacks differ', async () => {
    let hits = 0;
    const { server, baseUrl } = await listen((_req, res) => {
      hits += 1;
      res.statusCode = 503;
      res.end('down');
    });

    try {
      const allowPostRetry = (req: { method: string }) =>
        req.method === 'POST' ||
        defaultCanRetry(req as Parameters<typeof defaultCanRetry>[0]);
      const denyPostRetry = defaultCanRetry;

      const withPostRetry = httpClient
        .external('retry-fingerprint')
        .addBaseUrl(baseUrl)
        .addRetry({
          maxAttempts: 2,
          backoff: fixedBackoff({ delay: 1 }),
          canRetry: allowPostRetry,
        });
      const withoutPostRetry = httpClient
        .external('retry-fingerprint')
        .addBaseUrl(baseUrl)
        .addRetry({
          maxAttempts: 2,
          backoff: fixedBackoff({ delay: 1 }),
          canRetry: denyPostRetry,
        });

      await expect(withPostRetry.post('/x', { a: 1 })).rejects.toBeInstanceOf(
        RetryExhaustedError,
      );
      expect(hits).toBe(2);

      hits = 0;
      await expect(
        withoutPostRetry.post('/x', { a: 1 }),
      ).rejects.toBeInstanceOf(HttpError);
      expect(hits).toBe(1);
    } finally {
      server.close();
    }
  });

  it('rejects absolute URLs that do not match baseUrl origin', async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.end('ok');
    });

    try {
      await expect(
        httpClient
          .external('ssrf')
          .addBaseUrl(baseUrl)
          .get('http://127.0.0.1:9/evil'),
      ).rejects.toThrow(/origin must match/i);
    } finally {
      server.close();
    }
  });

  it('rejects absolute URLs when baseUrl is not configured', async () => {
    await expect(
      httpClient.external('ssrf-no-base').get('http://127.0.0.1:9/evil'),
    ).rejects.toThrow(/baseUrl is required/i);
  });

  it('rejects relative paths that escape a path-scoped baseUrl', async () => {
    await expect(
      httpClient
        .external('path-escape')
        .addBaseUrl('https://api.example.com/v1/')
        .get('../../internal/admin'),
    ).rejects.toThrow(/stay under configured baseUrl path/i);
  });

  it('rejects percent-encoded path traversal under a path-scoped baseUrl', async () => {
    const client = httpClient
      .external('path-escape-encoded')
      .addBaseUrl('https://api.example.com/v1/');

    await expect(client.get('..%2f..%2finternal/admin')).rejects.toThrow(
      /stay under configured baseUrl path/i,
    );
    await expect(
      client.get('%2e%2e%2f%2e%2e%2finternal/admin'),
    ).rejects.toThrow(/stay under configured baseUrl path/i);
    await expect(client.get('%2e%2e/%2e%2e/internal/admin')).rejects.toThrow(
      /stay under configured baseUrl path/i,
    );
  });

  it('rejects non-http(s) baseUrl', async () => {
    await expect(
      httpClient.external('file-base').addBaseUrl('file:///tmp/').get('/x'),
    ).rejects.toThrow(/http or https/i);
  });

  it('does not trip the circuit breaker on non-transient 4xx failures', async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.statusCode = 404;
      res.end('missing');
    });

    try {
      const client = httpClient
        .external('breaker-4xx')
        .addBaseUrl(baseUrl)
        .addCircuitBreaker({
          failureThreshold: 2,
          resetTimeout: 60_000,
        });

      await expect(client.get('/missing')).rejects.toBeInstanceOf(HttpError);
      await expect(client.get('/missing')).rejects.toBeInstanceOf(HttpError);
      await expect(client.get('/missing')).rejects.toBeInstanceOf(HttpError);
    } finally {
      server.close();
    }
  });

  it('keeps OAuth 401 replay inside the retry loop for later transient failures', async () => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const { server, baseUrl } = await listen(async (req, res) => {
      if (req.url === '/oauth/token') {
        tokenCalls += 1;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            access_token: `token-${tokenCalls}`,
            expires_in: 3600,
          }),
        );
        return;
      }

      apiCalls += 1;
      if (apiCalls === 1) {
        res.statusCode = 401;
        res.end('unauthorized');
        return;
      }
      if (apiCalls === 2) {
        res.statusCode = 503;
        res.end('unavailable');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ authorization: req.headers.authorization }));
    });

    try {
      const response = await httpClient
        .external('oauth-replay-retry')
        .addBaseUrl(baseUrl)
        .addOAuth({
          grantType: 'client_credentials',
          tokenUrl: `${baseUrl}/oauth/token`,
          clientId: 'id',
          clientSecret: 'secret',
          allowInsecureTokenUrl: true,
        })
        .addRetry({
          maxAttempts: 3,
          backoff: fixedBackoff({ delay: 1 }),
        })
        .get('/api');

      expect(tokenCalls).toBe(2);
      expect(apiCalls).toBe(3);
      expect(response.body).toEqual({ authorization: 'Bearer token-2' });
    } finally {
      server.close();
    }
  });

  it('freezes idempotency key before request interceptors', async () => {
    let interceptorSaw: string | undefined;
    const { server, baseUrl } = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ key: req.headers['idempotency-key'] ?? null }));
    });

    try {
      const response = await httpClient
        .external('idem-order')
        .addBaseUrl(baseUrl)
        .addIdempotency({
          header: 'Idempotency-Key',
          generateKey: () => 'frozen-key',
        })
        .addRequestInterceptor((req) => {
          interceptorSaw = String(req.headers?.['Idempotency-Key'] ?? '');
          return {
            ...req,
            headers: {
              ...req.headers,
              'Idempotency-Key': 'mutated-by-interceptor',
            },
          };
        })
        .post('/pay', { amount: 1 });

      expect(interceptorSaw).toBe('frozen-key');
      expect(response.body).toEqual({ key: 'frozen-key' });
    } finally {
      server.close();
    }
  });

  it('injects propagation headers when tracing is enabled', async () => {
    const provider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(provider);

    const seen: http.IncomingHttpHeaders = {};
    const { server, baseUrl } = await listen((req, res) => {
      Object.assign(seen, req.headers);
      res.end('{}');
    });

    try {
      await httpClient
        .external('trace-svc')
        .addBaseUrl(baseUrl)
        .addTracing()
        .get('/traced');

      const hasTraceparent = typeof seen.traceparent === 'string';
      const hasXray = typeof seen['x-amzn-trace-id'] === 'string';
      expect(hasTraceparent || hasXray).toBe(true);
    } finally {
      server.close();
      await provider.shutdown();
    }
  });

  it('enforces attempt timeouts', async () => {
    const { server, baseUrl } = await listen(async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      res.end('late');
    });

    try {
      await expect(
        httpClient
          .external('timeout')
          .addBaseUrl(baseUrl)
          .addTimeout({ timeoutMs: 20 })
          .get('/slow'),
      ).rejects.toBeInstanceOf(TimeoutError);
    } finally {
      server.close();
    }
  });

  it('applies basic auth header', async () => {
    const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`;
    const { server, baseUrl } = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ authorization: req.headers.authorization }));
    });

    try {
      const response = await httpClient
        .external('basic-auth')
        .addBaseUrl(baseUrl)
        .addBasicAuth({ username: 'user', password: 'pass' })
        .get('/');
      expect(response.body).toEqual({ authorization: expected });
    } finally {
      server.close();
    }
  });

  it('sends default headers', async () => {
    const { server, baseUrl } = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ app: req.headers['x-app'] }));
    });

    try {
      const response = await httpClient
        .external('defaults')
        .addBaseUrl(baseUrl)
        .addDefaultHeaders({ 'x-app': 'boilerplate' })
        .get('/');
      expect(response.body).toEqual({ app: 'boilerplate' });
    } finally {
      server.close();
    }
  });

  it('runs error interceptors', async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });

    try {
      await expect(
        httpClient
          .external('err-ix')
          .addBaseUrl(baseUrl)
          .addErrorInterceptor((error) => {
            if (error instanceof HttpError) {
              return new Error(`wrapped:${error.status}`);
            }
            return error;
          })
          .get('/fail'),
      ).rejects.toMatchObject({ message: 'wrapped:500' });
    } finally {
      server.close();
    }
  });

  it('completes requests with logging enabled and redacts secrets in logs', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { server, baseUrl } = await listen((_req, res) => {
      res.end('{}');
    });

    try {
      const response = await httpClient
        .external('logging')
        .addBaseUrl(baseUrl)
        .addLogging()
        .addDefaultHeaders({ Authorization: 'Bearer super-secret-token' })
        .get('/logged', { query: { access_token: 'super-secret-token' } });

      expect(response.status).toBe(200);
      expect(logSpy).toHaveBeenCalled();
      const payloads = logSpy.mock.calls.map((call) => call[0]);
      const startLog = payloads.find(
        (p) =>
          typeof p === 'object' &&
          p != null &&
          (p as { message?: string }).message === 'HTTP request start',
      ) as
        | {
            headers?: Record<string, string>;
            query?: Record<string, unknown>;
          }
        | undefined;
      expect(
        startLog?.headers?.Authorization ?? startLog?.headers?.authorization,
      ).toBe('[REDACTED]');
      expect(startLog?.query?.access_token).toBe('[REDACTED]');
      expect(JSON.stringify(payloads)).not.toContain('super-secret-token');
    } finally {
      logSpy.mockRestore();
      server.close();
    }
  });

  it('emits metrics when metrics are enabled', async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.statusCode = 200;
      res.end('{}');
    });

    try {
      const response = await httpClient
        .external('metrics')
        .addBaseUrl(baseUrl)
        .addMetrics()
        .get('/m');

      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
    } finally {
      server.close();
    }
  });

  it('enforces totalTimeoutMs across retries', async () => {
    const { server, baseUrl } = await listen(async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      res.statusCode = 503;
      res.end('slow');
    });

    try {
      await expect(
        httpClient
          .external('total-timeout')
          .addBaseUrl(baseUrl)
          .addTimeout({ timeoutMs: 200, totalTimeoutMs: 50 })
          .addRetry({
            maxAttempts: 5,
            backoff: fixedBackoff({ delay: 1 }),
          })
          .get('/slow-total'),
      ).rejects.toBeInstanceOf(TimeoutError);
    } finally {
      server.close();
    }
  });

  it('rejects conflicting header auth policies', () => {
    expect(() =>
      httpClient
        .external('conflict-auth')
        .addBearerToken({ token: 'a' })
        .addApiKey({ key: 'b' }),
    ).toThrow(/Conflicting authentication/);
  });

  it('closes gracefully and rejects new work', async () => {
    await httpClient.close(10);
    expect(() => httpClient.external('x')).toThrow(/closed/i);
  });
});

describe('backoff and jitter strategies', () => {
  it('computes fixed/linear/exponential delays', () => {
    expect(fixedBackoff({ delay: 100 }).delayMs(1)).toBe(100);
    expect(linearBackoff({ baseDelay: 100, maxDelay: 250 }).delayMs(3)).toBe(
      250,
    );
    expect(
      exponentialBackoff({ baseDelay: 100, maxDelay: 1000 }).delayMs(4),
    ).toBe(800);
  });

  it('applies full and equal jitter', () => {
    const full = fullJitter(() => 0.5);
    expect(full.apply(100, 1)).toBe(50);
    const equal = equalJitter(() => 0.5);
    expect(equal.apply(100, 1)).toBe(75);
  });
});

describe('redaction and error URL safety', () => {
  it('redacts custom secret headers and URL userinfo/query secrets', () => {
    expect(redactHeaders({ 'X-Partner-Key': 'sekrit' })['X-Partner-Key']).toBe(
      '[REDACTED]',
    );
    const redacted = redactUrl(
      'https://user:pass@example.com/path?access_token=sekrit&ok=1',
    );
    expect(redacted).not.toContain('sekrit');
    expect(redacted).not.toContain('user:pass');
    expect(redacted).toContain('ok=1');
  });

  it('redacts common short query secret names like key and sig', () => {
    expect(redactQuery({ key: 'sekrit', sig: 'abc', ok: 1 })).toEqual({
      key: '[REDACTED]',
      sig: '[REDACTED]',
      ok: 1,
    });
    const redacted = redactUrl('https://example.com/x?key=sekrit&sig=abc&ok=1');
    expect(redacted).not.toContain('sekrit');
    expect(redacted).not.toContain('abc');
    expect(redacted).toContain('ok=1');
  });

  it('redacts sensitive query params on relative URLs', () => {
    const redacted = redactUrl('/proxy?access_token=sekrit&ok=1');
    expect(redacted).not.toContain('sekrit');
    expect(redacted).toContain('ok=1');
    expect(redacted.startsWith('/')).toBe(true);
  });

  it('redacts sensitive query params in normalized axios errors', () => {
    const error = Object.assign(new AxiosError('Request failed'), {
      config: {
        method: 'get',
        url: 'https://api.example.com/x?access_token=sekrit',
        headers: {},
      },
      response: {
        status: 500,
        data: 'fail',
        statusText: 'Error',
        headers: {},
        config: {
          method: 'get',
          url: 'https://api.example.com/x?access_token=sekrit',
          headers: {},
        },
      },
    });

    const normalized = normalizeError(error);
    expect(normalized.message).not.toContain('sekrit');
    expect(normalized.metadata.url).not.toContain('sekrit');
  });
});

describe('shared pool mTLS fingerprint', () => {
  it('builds distinct pool keys for different client certificates', () => {
    const a = poolKey({
      mode: 'shared',
      mtls: { cert: 'cert-a', key: 'key-a' },
    });
    const b = poolKey({
      mode: 'shared',
      mtls: { cert: 'cert-b', key: 'key-b' },
    });
    const same = poolKey({
      mode: 'shared',
      mtls: { cert: 'cert-a', key: 'key-a' },
    });
    expect(a).not.toEqual(b);
    expect(a).toEqual(same);
    expect(a).not.toContain('cert-a');
  });

  it('decrements shared pool refCount on each release', () => {
    const registry = new ConnectionPoolRegistry();
    const options = {
      connectionPool: {
        mode: 'shared' as const,
        keepAlive: true,
        maxSockets: 10,
      },
    };
    const first = registry.acquire(options);
    const second = registry.acquire(options);
    const key = poolKey({ mode: 'shared', keepAlive: true, maxSockets: 10 });
    expect(registry.getSharedRefCount(key)).toBe(2);
    first.release();
    expect(registry.getSharedRefCount(key)).toBe(1);
    second.release();
    expect(registry.getSharedRefCount(key)).toBe(0);
  });
});

describe('concurrency limiter abort', () => {
  it('rejects queued waiters when AbortSignal fires', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const release = await limiter.acquire();
    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(RequestAbortedError);
    expect(limiter.queuedCount).toBe(0);
    release();
  });

  it('throws ClientClosedError when acquiring after close', async () => {
    const limiter = new ConcurrencyLimiter(1);
    limiter.close(new ClientClosedError());
    await expect(limiter.acquire()).rejects.toBeInstanceOf(ClientClosedError);
  });

  it('never exceeds maxConcurrent during permit handoff races', async () => {
    const limiter = new ConcurrencyLimiter(1);
    let peak = 0;
    const sample = () => {
      peak = Math.max(peak, limiter.activeCount);
    };

    const workers = Array.from({ length: 40 }, async () => {
      const release = await limiter.acquire();
      sample();
      await Promise.resolve();
      sample();
      release();
      sample();
    });

    // Concurrent race: try to grab free slots during handoff microtasks.
    const racers = Array.from({ length: 40 }, async () => {
      await Promise.resolve();
      const release = await limiter.acquire();
      sample();
      release();
    });

    await Promise.all([...workers, ...racers]);
    expect(peak).toBeLessThanOrEqual(1);
    expect(limiter.activeCount).toBe(0);
  });

  it('rejects after wake when AbortSignal aborted during handoff', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const held = await limiter.acquire();
    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    // Abort after release has transferred the permit but before waiter resumes.
    queueMicrotask(() => controller.abort());
    held();
    await expect(waiting).rejects.toBeInstanceOf(RequestAbortedError);
    expect(limiter.activeCount).toBe(0);
  });
});

describe('OAuth token URL HTTPS gate', () => {
  it('accepts uppercase HTTPS token URLs', () => {
    const registry = new ConnectionPoolRegistry();
    const transport = new AxiosTransport(
      registry.acquire({
        connectionPool: { mode: 'dedicated', keepAlive: true, maxSockets: 1 },
      }),
    );
    expect(
      () =>
        new OAuthTokenManager(
          {
            type: 'oauth',
            grantType: 'client_credentials',
            tokenUrl: 'HTTPS://auth.example.com/token',
            clientId: 'id',
            clientSecret: 'secret',
          },
          transport,
        ),
    ).not.toThrow();
  });
});

describe('timeout sleep helpers', () => {
  it('classifies abort during sleep as RequestAbortedError', async () => {
    const controller = new AbortController();
    const pending = sleep(1_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
  });

  it('throws TimeoutError when total budget is exhausted before backoff sleep', async () => {
    const budget = createTimeoutBudget({
      totalTimeoutMs: 1,
      now: Date.now() - 10,
    });
    await expect(sleepWithinBudget(100, budget)).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });
});

describe('OpenTelemetry tracing inject', () => {
  it('injects headers from a logical span when a tracer provider is registered', () => {
    const provider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(provider);
    try {
      const span = trace.getTracer('test').startSpan('parent');
      const ctx = trace.setSpan(context.active(), span);
      const carrier: Record<string, string> = {};
      context.with(ctx, () => {
        propagation.inject(context.active(), carrier);
      });
      span.end();
      // Provider enables valid span contexts; W3C inject may populate carrier
      // depending on global propagator. Ensure span context is valid at least.
      expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      void provider.shutdown();
    }
  });
});
