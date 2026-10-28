export type ClientKind = 'internal' | 'external';

export type ConnectionPoolMode = 'dedicated' | 'shared';

export interface ClientIdentity {
  kind: ClientKind;
  serviceName: string;
}

export interface BackoffStrategy {
  readonly name: string;
  delayMs(attempt: number): number;
}

export interface JitterStrategy {
  readonly name: string;
  apply(delayMs: number, attempt: number): number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff: BackoffStrategy;
  jitter?: JitterStrategy;
  canRetry?: (request: import('./request.types').HttpRequest) => boolean;
  isTransient?: (error: unknown) => boolean;
}

export interface TimeoutPolicy {
  timeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface CircuitBreakerPolicy {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxAttempts?: number;
}

export interface ConcurrencyLimitPolicy {
  maxConcurrent: number;
  /** When set, effective limit = max(1, floor(maxConcurrent / instanceCount)) */
  clusterAware?: boolean;
}

export interface CoalescingPolicy {
  enabled?: boolean;
  methods?: Array<'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
  key?: (request: import('./request.types').HttpRequest) => string;
}

export interface IdempotencyPolicy {
  header?: string;
  generateKey?: () => string;
}

export interface ConnectionPoolPolicy {
  mode: ConnectionPoolMode;
  keepAlive?: boolean;
  maxSockets?: number;
  maxFreeSockets?: number;
  keepAliveMsecs?: number;
  timeout?: number;
}

export interface DnsPolicy {
  family?: 0 | 4 | 6;
  hints?: number;
  lookupCacheTtlMs?: number;
}

export interface TlsPolicy {
  rejectUnauthorized?: boolean;
  ca?: string | Buffer | Array<string | Buffer>;
  minVersion?: string;
  maxVersion?: string;
  servername?: string;
}

export interface MtlsPolicy {
  cert: string | Buffer;
  key: string | Buffer;
  passphrase?: string;
  ca?: string | Buffer | Array<string | Buffer>;
}

export type RequestInterceptor = (
  request: import('./request.types').HttpRequest,
) =>
  | import('./request.types').HttpRequest
  | Promise<import('./request.types').HttpRequest>;

export type ResponseInterceptor = (
  response: import('./request.types').HttpResponse,
  request: import('./request.types').HttpRequest,
) =>
  | import('./request.types').HttpResponse
  | Promise<import('./request.types').HttpResponse>;

export type ErrorInterceptor = (
  error: unknown,
  request: import('./request.types').HttpRequest,
) => unknown | Promise<unknown>;

export interface ApiKeyAuthPolicy {
  type: 'apiKey';
  key: string;
  header?: string;
  prefix?: string;
}

export interface BasicAuthPolicy {
  type: 'basic';
  username: string;
  password: string;
}

export interface BearerAuthPolicy {
  type: 'bearer';
  token: string;
}

export interface OAuthClientCredentialsPolicy {
  type: 'oauth';
  grantType: 'client_credentials';
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
  skewMs?: number;
  allowInsecureTokenUrl?: boolean;
  extraTokenParams?: Record<string, string>;
}

export type AuthPolicy =
  | ApiKeyAuthPolicy
  | BasicAuthPolicy
  | BearerAuthPolicy
  | OAuthClientCredentialsPolicy;

export interface TelemetryPolicy {
  tracing?: boolean;
  metrics?: boolean;
  logging?: boolean;
}

export interface ClientPolicySnapshot {
  identity: ClientIdentity;
  baseUrl?: string;
  defaultHeaders: Record<string, string>;
  auth?: AuthPolicy;
  mtls?: MtlsPolicy;
  tls?: TlsPolicy;
  dns?: DnsPolicy;
  connectionPool: ConnectionPoolPolicy;
  timeout?: TimeoutPolicy;
  retry?: RetryPolicy;
  circuitBreaker?: CircuitBreakerPolicy;
  concurrencyLimit?: ConcurrencyLimitPolicy;
  coalescing?: CoalescingPolicy;
  idempotency?: IdempotencyPolicy;
  requestInterceptors: RequestInterceptor[];
  responseInterceptors: ResponseInterceptor[];
  errorInterceptors: ErrorInterceptor[];
  telemetry: TelemetryPolicy;
}

export function createDefaultPolicy(
  identity: ClientIdentity,
): ClientPolicySnapshot {
  return {
    identity,
    defaultHeaders: {},
    connectionPool: {
      mode: 'dedicated',
      keepAlive: true,
      maxSockets: 50,
      maxFreeSockets: 10,
      keepAliveMsecs: 1000,
    },
    requestInterceptors: [],
    responseInterceptors: [],
    errorInterceptors: [],
    telemetry: {},
  };
}
