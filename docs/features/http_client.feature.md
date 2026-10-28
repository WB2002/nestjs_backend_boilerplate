# Core HTTP Client

Global NestJS provider at `src/core/http-client` for outbound HTTP calls.

## Registration

`HttpClientModule` is `@Global()` and imported in `AppModule`. Inject `HttpClient` anywhere:

```ts
import { Injectable } from '@nestjs/common';
import {
  HttpClient,
  defaultCanRetry,
  exponentialBackoff,
  fullJitter,
} from '@/core/http-client';
import { randomUUID } from 'crypto';

@Injectable()
export class PaymentsGateway {
  private readonly client;

  constructor(httpClient: HttpClient) {
    this.client = httpClient
      .external('payment-service')
      .addBaseUrl(process.env.PAYMENT_SERVICE_BASE_URL!)
      .addOAuth({
        grantType: 'client_credentials',
        tokenUrl: process.env.PAYMENT_TOKEN_URL!,
        clientId: process.env.PAYMENT_CLIENT_ID!,
        clientSecret: process.env.PAYMENT_CLIENT_SECRET!,
      })
      .addIdempotency({
        header: 'Idempotency-Key',
        generateKey: () => randomUUID(),
      })
      .addRetry({
        maxAttempts: 3,
        backoff: exponentialBackoff({ baseDelay: 100, maxDelay: 5000 }),
        jitter: fullJitter(),
        canRetry: (req) =>
          defaultCanRetry(req) || req.headers?.['Idempotency-Key'] != null,
      })
      .addCircuitBreaker({ failureThreshold: 5, resetTimeout: 10_000 })
      .addConcurrencyLimit({ maxConcurrent: 50, clusterAware: true })
      .addTimeout({ timeoutMs: 5_000, totalTimeoutMs: 15_000 })
      .addTracing()
      .addMetrics()
      .addLogging();
  }

  getPayment(id: string) {
    return this.client.get(`/payments/${id}`);
  }
}
```

Internal and external clients share the same defaults. Use the kind only for identity, telemetry, and runtime isolation:

```ts
httpClient.internal('user-service').addBaseUrl('http://user-service');
httpClient.external('stripe').addBaseUrl('https://api.stripe.com');
```

## Design notes

- `.addX()` returns a new immutable configured client. Policies are copied; Axios/agents are **not** created until the first request.
- Prefer one long-lived configured client per dependency (typically built in the constructor). Rebuilding with new inline callbacks/interceptors creates a distinct runtime fingerprint and may allocate new pools/state.
- Each materialized logical client owns isolated OAuth, circuit breaker, concurrency, and coalescing state.
- **Multi-VM concurrency:** `.addConcurrencyLimit({ maxConcurrent: 50, clusterAware: true })` divides the cap by `HTTP_CLIENT_INSTANCE_COUNT` (default `1`) at runtime: `effective = max(1, floor(maxConcurrent / instanceCount))`. Set `HTTP_CLIENT_INSTANCE_COUNT` to your **maximum** expected task/VM count (ECS desired count ceiling or ASG max) so the **sum across instances** stays near `maxConcurrent`. Without `clusterAware`, each process uses the full `maxConcurrent` (legacy behavior).
- **Adaptive concurrency (Phase II):** `.addConcurrencyLimit({ mode: 'adaptive', maxConcurrent: 50, clusterAware: true, adaptive: { algorithm: 'vegas', initialLimit: 10, minLimit: 2 } })`. Limiter source is **vendored in-repo** at `src/core/http-client/resilience/adaptive/` (Fortify adaptive 0.1.0, MIT — see `UPSTREAM.md`); **no npm** `@klarlabs-studio/*` dependency. Default resolver algorithm when omitted: **`vegas`**. **`maxConcurrent`** sets default **`maxLimit`** when `adaptive.maxLimit` is omitted. **Fixed** mode (default) queues waiters; **adaptive** fail-fasts with `AdaptiveLimitExceededError` when the tuned cap is full.
- Connection pools may be `.connectionPool({ mode: 'shared' | 'dedicated', ... })`. Shared pools are reference-counted and reused only when DNS/TLS/mTLS settings match (mTLS material is hashed into the pool key).
- `baseUrl` is required for every outbound request (relative or absolute). It must use `http` or `https`. Absolute URLs must match the configured `baseUrl` origin, and resolved paths must stay under the configured `baseUrl` path (rejects `../` and percent-encoded equivalents such as `..%2f`). Axios follows no redirects (`maxRedirects: 0`) by default — do not pass raw user-controlled URLs.
- Use `.addRequestCoalescing()` to coalesce identical in-flight safe reads (default GET/HEAD).
- Plugin **configuration order does not define runtime order**. The pipeline is fixed:
  1. prepare request / freeze idempotency key
  2. request interceptors (frozen idempotency key is re-applied if changed)
  3. telemetry (logical)
  4. coalescing
  5. circuit breaker (final logical outcome; transient failures and exhausted transient retries trip the breaker; half-open probes re-trip on any failure)
  6. auth (including independent one-shot OAuth 401 refresh that stays inside the retry loop)
  7. transient retry / backoff / jitter (backoff respects total timeout budget)
  8. per-attempt concurrency permit + timeout + Axios
  9. normalize errors
  10. response / error interceptors

## Authentication

| Method | API |
|--------|-----|
| API key | `.addApiKey({ key, header?, prefix? })` |
| Basic | `.addBasicAuth({ username, password })` |
| Bearer | `.addBearerToken({ token })` |
| OAuth client credentials | `.addOAuth({ grantType: 'client_credentials', tokenUrl, clientId, clientSecret, ... })` |
| mTLS | `.addMtls({ cert, key, ca?, passphrase? })` |

OAuth acquires/caches tokens, applies skew, single-flights concurrent token requests, and retries the original request at most once after a 401 refresh. Token requests never recurse through the OAuth plugin.

## Telemetry

- `.addTracing()` emits OpenTelemetry client spans and injects AWS X-Ray propagation headers. Export via ADOT Collector / CloudWatch Agent with the X-Ray exporter. The legacy `aws-xray-sdk` is intentionally not used.
- `.addMetrics()` emits CloudWatch Embedded Metric Format (EMF) to stdout for agent/Lambda collection.
- `.addLogging()` writes structured Nest/Winston logs with sensitive headers/query values redacted.

## Inbound deadline inheritance

When outbound `HttpClient` runs inside an HTTP handler (request-deadline ALS active):

- If the outbound request has **no** `signal`, the inbound **`AbortSignal`** is attached automatically.
- **`timeoutMs`** and **`totalTimeoutMs`** from `.addTimeout(...)` are capped by **`remainingMs()`** on the inbound deadline (`min(policy, remaining)`).
- Background jobs or CLI code without ALS behave unchanged (no signal, policy timeouts only).

Handlers can still pass an explicit per-call `signal` to override inbound propagation.

## Lifecycle

`HttpClient` implements `OnApplicationShutdown`. With `app.enableShutdownHooks()` already enabled in `main.ts`:

```
NestJS OnApplicationShutdown → HttpClient.close()
```

`close()` rejects new work, drains in-flight logical operations up to a grace period, aborts coalesced work, rejects queued concurrency waiters, clears OAuth state, and releases agents/pools.

## Errors

Normalized hierarchy:

- `HttpClientError`
  - `NetworkError`
  - `TimeoutError`
  - `HttpError`
  - `CircuitOpenError`
  - `RetryExhaustedError`
  - `RequestAbortedError`
  - `ClientClosedError`
