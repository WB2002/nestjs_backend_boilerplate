import type {
  AuthPolicy,
  ClientIdentity,
  ClientPolicySnapshot,
  MtlsPolicy,
} from '../types';
import { ClientRuntime } from './client-runtime';
import type { ConnectionPoolRegistry } from '../transport/connection-pool.registry';
import {
  hashCa,
  hashMaterial,
  interceptorId,
  callbackId,
  sortedHeadersFingerprint,
} from '../utils/fingerprint';

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, ClientRuntime>();
  private isClosed = false;

  constructor(private readonly poolRegistry: ConnectionPoolRegistry) {}

  getOrCreate(policy: ClientPolicySnapshot): ClientRuntime {
    if (this.isClosed) {
      throw new Error('Runtime registry is closed');
    }
    const key = runtimeKey(policy.identity, policy);
    const existing = this.runtimes.get(key);
    if (existing) {
      return existing;
    }
    const runtime = new ClientRuntime(policy, this.poolRegistry);
    this.runtimes.set(key, runtime);
    return runtime;
  }

  async close(graceMs: number): Promise<void> {
    this.isClosed = true;
    const closing = [...this.runtimes.values()].map((runtime) =>
      runtime.close(graceMs),
    );
    await Promise.all(closing);
    this.runtimes.clear();
    await this.poolRegistry.closeAll();
  }
}

function runtimeKey(
  identity: ClientIdentity,
  policy: ClientPolicySnapshot,
): string {
  // Materialized runtimes are keyed by identity + full configuration fingerprint
  // (secrets hashed) so divergent credentials/headers/interceptors never share state.
  return JSON.stringify({
    identity,
    baseUrl: policy.baseUrl,
    auth: fingerprintAuth(policy.auth),
    defaultHeaders: sortedHeadersFingerprint(policy.defaultHeaders),
    requestInterceptors: policy.requestInterceptors.map(interceptorId),
    responseInterceptors: policy.responseInterceptors.map(interceptorId),
    errorInterceptors: policy.errorInterceptors.map(interceptorId),
    connectionPool: policy.connectionPool,
    timeout: policy.timeout,
    retry: policy.retry
      ? {
          maxAttempts: policy.retry.maxAttempts,
          backoff: policy.retry.backoff.name,
          jitter: policy.retry.jitter?.name,
          canRetry: policy.retry.canRetry
            ? callbackId(policy.retry.canRetry)
            : undefined,
          isTransient: policy.retry.isTransient
            ? callbackId(policy.retry.isTransient)
            : undefined,
        }
      : undefined,
    circuitBreaker: policy.circuitBreaker,
    concurrencyLimit: policy.concurrencyLimit,
    coalescing: policy.coalescing
      ? {
          enabled: policy.coalescing.enabled,
          methods: policy.coalescing.methods,
          key: policy.coalescing.key
            ? callbackId(policy.coalescing.key)
            : undefined,
        }
      : undefined,
    idempotency: policy.idempotency
      ? {
          header: policy.idempotency.header,
          generateKey: policy.idempotency.generateKey
            ? callbackId(policy.idempotency.generateKey)
            : undefined,
        }
      : undefined,
    telemetry: policy.telemetry,
    mtls: fingerprintMtls(policy.mtls),
    tls: policy.tls,
    dns: policy.dns,
  });
}

function fingerprintAuth(auth: AuthPolicy | undefined) {
  if (!auth) {
    return undefined;
  }
  switch (auth.type) {
    case 'bearer':
      return { type: auth.type, token: hashMaterial(auth.token) };
    case 'apiKey':
      return {
        type: auth.type,
        key: hashMaterial(auth.key),
        header: auth.header,
        prefix: auth.prefix,
      };
    case 'basic':
      return {
        type: auth.type,
        username: auth.username,
        password: hashMaterial(auth.password),
      };
    case 'oauth':
      return {
        type: auth.type,
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        clientSecret: hashMaterial(auth.clientSecret),
        scope: auth.scope,
        audience: auth.audience,
        skewMs: auth.skewMs,
        allowInsecureTokenUrl: auth.allowInsecureTokenUrl,
        extraTokenParams: auth.extraTokenParams
          ? hashMaterial(JSON.stringify(auth.extraTokenParams))
          : undefined,
      };
    default:
      return { type: (auth as AuthPolicy).type };
  }
}

function fingerprintMtls(mtls: MtlsPolicy | undefined) {
  if (!mtls) {
    return undefined;
  }
  return {
    cert: hashMaterial(mtls.cert),
    key: hashMaterial(mtls.key),
    passphrase: hashMaterial(mtls.passphrase),
    ca: hashCa(mtls.ca),
  };
}
