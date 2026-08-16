import type {
  ApiKeyAuthPolicy,
  AuthPolicy,
  BasicAuthPolicy,
  BearerAuthPolicy,
  CircuitBreakerPolicy,
  ClientPolicySnapshot,
  CoalescingPolicy,
  ConcurrencyLimitPolicy,
  ConnectionPoolPolicy,
  DnsPolicy,
  ErrorInterceptor,
  HttpBodyRequestOptions,
  HttpRequest,
  HttpRequestOptions,
  HttpResponse,
  IdempotencyPolicy,
  MtlsPolicy,
  OAuthClientCredentialsPolicy,
  RequestInterceptor,
  ResponseInterceptor,
  RetryPolicy,
  TimeoutPolicy,
  TlsPolicy,
} from './types';
import type { RuntimeRegistry } from './runtime/runtime-registry';

export class ConfiguredHttpClient {
  constructor(
    private readonly policy: ClientPolicySnapshot,
    private readonly registry: RuntimeRegistry,
  ) {}

  getPolicy(): ClientPolicySnapshot {
    return this.policy;
  }

  get identity() {
    return this.policy.identity;
  }

  addBaseUrl(baseUrl: string): ConfiguredHttpClient {
    return this.withPolicy({ baseUrl });
  }

  addDefaultHeaders(headers: Record<string, string>): ConfiguredHttpClient {
    return this.withPolicy({
      defaultHeaders: {
        ...this.policy.defaultHeaders,
        ...headers,
      },
    });
  }

  addTimeout(policy: TimeoutPolicy): ConfiguredHttpClient {
    return this.withPolicy({ timeout: policy });
  }

  addRetry(policy: RetryPolicy): ConfiguredHttpClient {
    return this.withPolicy({ retry: policy });
  }

  addRequestCoalescing(policy: CoalescingPolicy = {}): ConfiguredHttpClient {
    return this.withPolicy({
      coalescing: {
        enabled: true,
        ...policy,
      },
    });
  }

  addCircuitBreaker(policy: CircuitBreakerPolicy): ConfiguredHttpClient {
    return this.withPolicy({ circuitBreaker: policy });
  }

  addConcurrencyLimit(policy: ConcurrencyLimitPolicy): ConfiguredHttpClient {
    return this.withPolicy({ concurrencyLimit: policy });
  }

  addIdempotency(policy: IdempotencyPolicy): ConfiguredHttpClient {
    return this.withPolicy({ idempotency: policy });
  }

  addRequestInterceptor(interceptor: RequestInterceptor): ConfiguredHttpClient {
    return this.withPolicy({
      requestInterceptors: [...this.policy.requestInterceptors, interceptor],
    });
  }

  addResponseInterceptor(
    interceptor: ResponseInterceptor,
  ): ConfiguredHttpClient {
    return this.withPolicy({
      responseInterceptors: [...this.policy.responseInterceptors, interceptor],
    });
  }

  addErrorInterceptor(interceptor: ErrorInterceptor): ConfiguredHttpClient {
    return this.withPolicy({
      errorInterceptors: [...this.policy.errorInterceptors, interceptor],
    });
  }

  addTracing(): ConfiguredHttpClient {
    return this.withPolicy({
      telemetry: { ...this.policy.telemetry, tracing: true },
    });
  }

  addMetrics(): ConfiguredHttpClient {
    return this.withPolicy({
      telemetry: { ...this.policy.telemetry, metrics: true },
    });
  }

  addLogging(): ConfiguredHttpClient {
    return this.withPolicy({
      telemetry: { ...this.policy.telemetry, logging: true },
    });
  }

  addApiKey(policy: Omit<ApiKeyAuthPolicy, 'type'>): ConfiguredHttpClient {
    return this.withAuth({ type: 'apiKey', ...policy });
  }

  addBasicAuth(policy: Omit<BasicAuthPolicy, 'type'>): ConfiguredHttpClient {
    return this.withAuth({ type: 'basic', ...policy });
  }

  addBearerToken(policy: Omit<BearerAuthPolicy, 'type'>): ConfiguredHttpClient {
    return this.withAuth({ type: 'bearer', ...policy });
  }

  addOAuth(
    policy: Omit<OAuthClientCredentialsPolicy, 'type'>,
  ): ConfiguredHttpClient {
    return this.withAuth({ type: 'oauth', ...policy });
  }

  addMtls(policy: MtlsPolicy): ConfiguredHttpClient {
    return this.withPolicy({ mtls: policy });
  }

  addTls(policy: TlsPolicy): ConfiguredHttpClient {
    return this.withPolicy({ tls: policy });
  }

  addDns(policy: DnsPolicy): ConfiguredHttpClient {
    return this.withPolicy({ dns: policy });
  }

  connectionPool(policy: ConnectionPoolPolicy): ConfiguredHttpClient {
    return this.withPolicy({ connectionPool: policy });
  }

  async get<T = unknown>(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'GET', url });
  }

  async post<T = unknown>(
    url: string,
    body?: unknown,
    options: HttpBodyRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'POST', url, body });
  }

  async put<T = unknown>(
    url: string,
    body?: unknown,
    options: HttpBodyRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'PUT', url, body });
  }

  async patch<T = unknown>(
    url: string,
    body?: unknown,
    options: HttpBodyRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'PATCH', url, body });
  }

  async delete<T = unknown>(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'DELETE', url });
  }

  async head<T = unknown>(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'HEAD', url });
  }

  async request<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
    const runtime = this.registry.getOrCreate(this.policy);
    return runtime.request<T>(request);
  }

  private withAuth(auth: AuthPolicy): ConfiguredHttpClient {
    if (this.policy.auth && this.policy.auth.type !== auth.type) {
      const existing = this.policy.auth.type;
      const next = auth.type;
      if (
        (isHeaderAuth(existing) && isHeaderAuth(next)) ||
        (existing === 'oauth' && isHeaderAuth(next)) ||
        (next === 'oauth' && isHeaderAuth(existing))
      ) {
        throw new Error(
          `Conflicting authentication policies: ${existing} and ${next}`,
        );
      }
    }
    return this.withPolicy({ auth });
  }

  private withPolicy(
    patch: Partial<ClientPolicySnapshot>,
  ): ConfiguredHttpClient {
    return new ConfiguredHttpClient(
      {
        ...this.policy,
        ...patch,
        identity: this.policy.identity,
        defaultHeaders: patch.defaultHeaders ?? this.policy.defaultHeaders,
        requestInterceptors:
          patch.requestInterceptors ?? this.policy.requestInterceptors,
        responseInterceptors:
          patch.responseInterceptors ?? this.policy.responseInterceptors,
        errorInterceptors:
          patch.errorInterceptors ?? this.policy.errorInterceptors,
        telemetry: patch.telemetry ?? this.policy.telemetry,
        connectionPool: patch.connectionPool ?? this.policy.connectionPool,
      },
      this.registry,
    );
  }
}

function isHeaderAuth(type: string): boolean {
  return type === 'apiKey' || type === 'basic' || type === 'bearer';
}
