import type { ClientPolicySnapshot, HttpRequest, HttpResponse } from '../types';
import {
  ClientClosedError,
  CircuitOpenError,
  HttpError,
  RetryExhaustedError,
  normalizeError,
} from '../errors';
import { applyAuth, assertCompatibleAuth, OAuthTokenManager } from '../auth';
import {
  CircuitBreaker,
  ConcurrencyLimiter,
  RequestCoalescer,
  computeBackoffDelayMs,
  createTimeoutBudget,
  defaultCoalescingKey,
  isDefaultCoalescable,
  isRetryEligible,
  defaultIsTransient,
  isBreakerFailure,
  resolveAttemptTimeoutMs,
  resolveIdempotencyKey,
  resolveEffectiveMaxConcurrent,
  parseHttpClientInstanceCount,
  sleep,
  sleepWithinBudget,
} from '../resilience';
import { AxiosTransport, ConnectionPoolRegistry } from '../transport';
import {
  emitHttpMetrics,
  logRequestFailure,
  logRequestStart,
  logRequestSuccess,
  redactUrl,
  startAttemptTrace,
  startLogicalTrace,
} from '../telemetry';
import {
  createAttemptContext,
  createLogicalOperation,
} from './operation-context';
import { withoutUndefined } from '../utils/without-undefined';

export class ClientRuntime {
  private readonly transport: AxiosTransport;
  private readonly oauth?: OAuthTokenManager;
  private readonly breaker?: CircuitBreaker;
  private readonly limiter?: ConcurrencyLimiter;
  private readonly coalescer = new RequestCoalescer();
  private readonly inflight = new Set<Promise<unknown>>();
  private closed = false;

  constructor(
    private readonly policy: ClientPolicySnapshot,
    poolRegistry: ConnectionPoolRegistry,
  ) {
    assertCompatibleAuth(policy.auth);
    validatePolicy(policy);

    const agents = poolRegistry.acquire(
      withoutUndefined({
        connectionPool: policy.connectionPool,
        tls: policy.tls,
        mtls: policy.mtls,
        dns: policy.dns,
      }),
    );
    this.transport = new AxiosTransport(agents);

    if (policy.auth?.type === 'oauth') {
      this.oauth = new OAuthTokenManager(policy.auth, this.transport);
    }
    if (policy.circuitBreaker) {
      this.breaker = new CircuitBreaker(
        policy.circuitBreaker.failureThreshold,
        policy.circuitBreaker.resetTimeout,
        policy.circuitBreaker.halfOpenMaxAttempts,
      );
    }
    if (policy.concurrencyLimit) {
      const effectiveMax = resolveEffectiveMaxConcurrent(
        policy.concurrencyLimit,
        parseHttpClientInstanceCount(),
      );
      this.limiter = new ConcurrencyLimiter(effectiveMax);
    }
  }

  async request<T = unknown>(input: HttpRequest): Promise<HttpResponse<T>> {
    if (this.closed) {
      throw new ClientClosedError();
    }

    const work = this.executeLogicalRequest<T>(input);
    this.inflight.add(work);
    try {
      return await work;
    } finally {
      this.inflight.delete(work);
    }
  }

  async close(graceMs: number): Promise<void> {
    this.closed = true;
    this.coalescer.clear();
    this.limiter?.close(new ClientClosedError());
    this.oauth?.clear();

    if (this.inflight.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.inflight]),
        sleep(graceMs),
      ]);
    }

    this.transport.close();
  }

  private async executeLogicalRequest<T>(
    input: HttpRequest,
  ): Promise<HttpResponse<T>> {
    const startedAt = Date.now();
    const prepared: HttpRequest = {
      ...input,
      headers: {
        ...this.policy.defaultHeaders,
        ...input.headers,
      },
      url: input.url || input.path || '/',
    };

    const idempotency = resolveIdempotencyKey(
      prepared,
      this.policy.idempotency,
    );
    const frozenKey = idempotency.key;
    const idempotencyHeader =
      this.policy.idempotency?.header ?? 'Idempotency-Key';

    let request = await this.applyRequestInterceptors(idempotency.request);
    if (frozenKey) {
      request = {
        ...request,
        headers: {
          ...request.headers,
          [idempotencyHeader]: frozenKey,
        },
      };
    }

    const budget = createTimeoutBudget(
      withoutUndefined({
        timeoutMs: request.timeoutMs ?? this.policy.timeout?.timeoutMs,
        totalTimeoutMs: this.policy.timeout?.totalTimeoutMs,
      }),
    );

    const coalescingKey = this.resolveCoalescingKey(request);
    const operation = createLogicalOperation(
      request,
      withoutUndefined({
        idempotencyKey: frozenKey,
        coalescingKey,
        totalDeadlineAt: budget.totalDeadlineAt,
      }),
    );

    const logicalTrace = startLogicalTrace(
      this.policy.identity,
      request,
      Boolean(this.policy.telemetry.tracing),
    );
    logRequestStart(
      Boolean(this.policy.telemetry.logging),
      this.policy.identity,
      request,
      operation.requestId,
    );

    try {
      const execute = async (): Promise<HttpResponse<T>> => {
        this.breaker?.assertClosed();
        try {
          const response = await this.executeWithAuthAndRetry<T>(
            request,
            operation,
            budget,
            logicalTrace,
          );
          this.breaker?.recordSuccess();
          return response;
        } catch (error) {
          if (this.breaker) {
            const halfOpen = this.breaker.getState() === 'half_open';
            const isCircuitOpenError =
              error instanceof CircuitOpenError ||
              (error instanceof Error && error.name === 'CircuitOpenError');
            const isFailure = isCircuitOpenError
              ? false
              : halfOpen
                ? true
                : isBreakerFailure(
                    error,
                    this.policy.retry?.isTransient ?? defaultIsTransient,
                  );
            if (isFailure) {
              this.breaker.recordFailure();
            }
          }
          throw error;
        }
      };

      let response: HttpResponse<T>;
      if (coalescingKey) {
        response = (await this.coalescer.run(
          coalescingKey,
          async (signal) => {
            const previousSignal = request.signal;
            request = withoutUndefined({ ...request, signal });
            try {
              return (await execute()) as HttpResponse;
            } finally {
              request = withoutUndefined({
                ...request,
                signal: previousSignal,
              });
            }
          },
          request.signal,
        )) as HttpResponse<T>;
      } else {
        response = await execute();
      }

      response = await this.applyResponseInterceptors(response, request);
      logicalTrace?.endSuccess(response);
      const latencyMs = Date.now() - startedAt;
      logRequestSuccess(
        Boolean(this.policy.telemetry.logging),
        this.policy.identity,
        request,
        response,
        operation.requestId,
        latencyMs,
        operation.attempts,
      );
      await emitHttpMetrics({
        enabled: Boolean(this.policy.telemetry.metrics),
        identity: this.policy.identity,
        method: request.method,
        status: response.status,
        latencyMs,
        attempts: Math.max(1, operation.attempts),
        success: response.ok,
      });
      return response;
    } catch (error) {
      const normalized = await this.applyErrorInterceptors(error, request);
      const finalError = normalizeError(normalized, {
        serviceName: this.policy.identity.serviceName,
        kind: this.policy.identity.kind,
        method: request.method,
        url: request.url,
        requestId: operation.requestId,
        attempts: operation.attempts,
      });
      logicalTrace?.endError(finalError);
      const latencyMs = Date.now() - startedAt;
      logRequestFailure(
        Boolean(this.policy.telemetry.logging),
        this.policy.identity,
        request,
        finalError,
        operation.requestId,
        latencyMs,
        operation.attempts,
      );
      await emitHttpMetrics({
        enabled: Boolean(this.policy.telemetry.metrics),
        identity: this.policy.identity,
        method: request.method,
        latencyMs,
        attempts: Math.max(1, operation.attempts),
        success: false,
        errorCode: finalError.code,
      });
      throw finalError;
    }
  }

  private async executeWithAuthAndRetry<T>(
    request: HttpRequest,
    operation: ReturnType<typeof createLogicalOperation>,
    budget: ReturnType<typeof createTimeoutBudget>,
    logicalTrace?: ReturnType<typeof startLogicalTrace>,
  ): Promise<HttpResponse<T>> {
    const retryPolicy = this.policy.retry;
    const maxAttempts = retryPolicy?.maxAttempts ?? 1;
    const hasIdempotencyKey = Boolean(operation.idempotencyKey);
    const retryAllowed =
      !retryPolicy || isRetryEligible(request, retryPolicy, hasIdempotencyKey);

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      operation.attempts = attempt;
      try {
        return await this.executeSingleAttemptWithAuth<T>(
          request,
          operation,
          budget,
          attempt,
          logicalTrace,
        );
      } catch (error) {
        lastError = error;

        // Independent OAuth 401 recovery path (not part of transient retry).
        if (
          this.oauth &&
          !operation.oauthReplayUsed &&
          error instanceof HttpError &&
          error.status === 401
        ) {
          operation.oauthReplayUsed = true;
          await this.oauth.refresh();
          // Replay without consuming an extra attempt slot.
          attempt -= 1;
          continue;
        }

        const isTransient = retryPolicy?.isTransient
          ? retryPolicy.isTransient(error)
          : defaultIsTransient(error);

        if (
          !retryAllowed ||
          !retryPolicy ||
          attempt >= maxAttempts ||
          !isTransient
        ) {
          break;
        }

        const delayMs = computeBackoffDelayMs(retryPolicy, attempt);
        await sleepWithinBudget(delayMs, budget, request.signal);
      }
    }

    if (retryPolicy && operation.attempts > 1) {
      throw new RetryExhaustedError('Retry attempts exhausted', {
        cause: lastError,
        metadata: {
          attempts: operation.attempts,
          method: request.method,
          url: request.url,
          requestId: operation.requestId,
        },
      });
    }

    throw lastError;
  }

  private async executeSingleAttemptWithAuth<T>(
    request: HttpRequest,
    operation: ReturnType<typeof createLogicalOperation>,
    budget: ReturnType<typeof createTimeoutBudget>,
    attempt: number,
    logicalTrace?: ReturnType<typeof startLogicalTrace>,
  ): Promise<HttpResponse<T>> {
    let authed = await applyAuth(request, this.policy.auth, this.oauth);
    const attemptTimeoutMs = resolveAttemptTimeoutMs(budget);
    const attemptContext = createAttemptContext(attempt, attemptTimeoutMs);
    const attemptTrace = startAttemptTrace(
      this.policy.identity,
      authed,
      attempt,
      Boolean(this.policy.telemetry.tracing),
      logicalTrace,
    );

    if (logicalTrace) {
      authed = {
        ...authed,
        headers: logicalTrace.injectHeaders({
          ...(authed.headers as Record<string, string>),
        }),
      };
    }

    const release = this.limiter
      ? await this.limiter.acquire(authed.signal)
      : undefined;
    try {
      const response = await this.transport.request<T>(
        authed,
        withoutUndefined({
          baseUrl: this.policy.baseUrl,
          defaultHeaders: this.policy.defaultHeaders,
          timeoutMs: attemptContext.timeoutMs,
          signal: authed.signal,
        }),
      );

      if (!response.ok) {
        const safeUrl = redactUrl(String(authed.url ?? ''));
        const error = new HttpError(
          `HTTP ${response.status} for ${authed.method} ${safeUrl}`,
          {
            status: response.status,
            responseBody: response.body,
            metadata: {
              method: authed.method,
              url: safeUrl,
              requestId: operation.requestId,
              attempt,
            },
          },
        );
        attemptTrace?.endError(error);
        throw error;
      }

      attemptTrace?.endSuccess(response);
      return response;
    } catch (error) {
      attemptTrace?.endError(error);
      throw normalizeError(error, {
        method: request.method,
        url: request.url,
        requestId: operation.requestId,
        attempt,
      });
    } finally {
      release?.();
    }
  }

  private resolveCoalescingKey(request: HttpRequest): string | undefined {
    const policy = this.policy.coalescing;
    if (!policy || policy.enabled === false) {
      return undefined;
    }

    const methods = policy.methods ?? ['GET', 'HEAD'];
    if (!methods.includes(request.method as 'GET' | 'HEAD')) {
      return undefined;
    }
    if (!isDefaultCoalescable(request.method) && !policy.methods) {
      return undefined;
    }
    if (request.responseType === 'stream') {
      throw new Error('Streaming responses cannot be coalesced');
    }
    if (request.multipart || isNonReplayableBody(request.body)) {
      throw new Error('Non-replayable request body cannot be coalesced');
    }
    return policy.key ? policy.key(request) : defaultCoalescingKey(request);
  }

  private async applyRequestInterceptors(
    request: HttpRequest,
  ): Promise<HttpRequest> {
    let current = request;
    for (const interceptor of this.policy.requestInterceptors) {
      current = await interceptor(current);
    }
    return current;
  }

  private async applyResponseInterceptors<T>(
    response: HttpResponse<T>,
    request: HttpRequest,
  ): Promise<HttpResponse<T>> {
    let current: HttpResponse = response;
    for (const interceptor of this.policy.responseInterceptors) {
      current = await interceptor(current, request);
    }
    return current as HttpResponse<T>;
  }

  private async applyErrorInterceptors(
    error: unknown,
    request: HttpRequest,
  ): Promise<unknown> {
    let current = error;
    for (const interceptor of this.policy.errorInterceptors) {
      current = await interceptor(current, request);
    }
    return current;
  }
}

function validatePolicy(policy: ClientPolicySnapshot): void {
  if (policy.timeout?.timeoutMs != null && policy.timeout.timeoutMs < 1) {
    throw new Error('timeoutMs must be >= 1');
  }
  if (
    policy.timeout?.totalTimeoutMs != null &&
    policy.timeout.totalTimeoutMs < 1
  ) {
    throw new Error('totalTimeoutMs must be >= 1');
  }
  if (policy.retry && policy.retry.maxAttempts < 1) {
    throw new Error('maxAttempts must be >= 1');
  }
  if (policy.concurrencyLimit && policy.concurrencyLimit.maxConcurrent < 1) {
    throw new Error('maxConcurrent must be >= 1');
  }
}

function isNonReplayableBody(body: unknown): boolean {
  if (body == null) {
    return false;
  }
  if (typeof body === 'object' && body !== null) {
    const maybeStream = body as { pipe?: unknown; read?: unknown };
    if (typeof maybeStream.pipe === 'function') {
      return true;
    }
  }
  return false;
}
