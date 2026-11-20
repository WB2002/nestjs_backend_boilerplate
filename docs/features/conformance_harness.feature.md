# Conformance Test Harness

Test-only module at `src/conformance/` exposing synthetic control endpoints for black-box behavioral verification against the [conformance test contract](../../../backend_boilerplate_conformance_tests/CONTRACT.md).

## Purpose & Scope

The conformance harness provides standard HTTP probes enabling language-agnostic conformance suites to verify internal runtime behaviors that are not directly observable through end-user business APIs:

- Multi-tier cache stampede protection, single-flight coalescing, negative caching, and TTL expiry.
- Outbound `HttpClient` retry strategies, backoff curves, jitter, circuit breaking, timeouts, and deadline propagation.
- Inbound deadline cancellation signal propagation and remaining budget accounting.
- Inbound priority shedding (`@ApiPriority`) tiers under high concurrency.
- Multi-identifier rate limiting (`userId`, `device fingerprint`, `guest cookie`).
- PII and sensitive data redaction for application logs and OpenTelemetry span attributes.

---

## Safety & Environment Gate

The harness is strictly isolated from production environments:

1. **Opt-in registration:** `ConformanceModule` is only imported into `AppModule` when `isConformanceHarnessEnabled()` returns `true` (`CONFORMANCE_HARNESS_ENABLED=true`).
2. **Production refusal:** `validateEnv` (`src/common/config/validate-env.ts`) executes at application boot. If `NODE_ENV=production` and `CONFORMANCE_HARNESS_ENABLED=true`, boot fails immediately with:
   ```text
   CONFORMANCE_HARNESS_ENABLED cannot be true when NODE_ENV=production
   ```
3. **No production bundle leakage:** No production business logic depends on conformance controllers or services.
4. **Bearer token:** When the harness is enabled, set `CONFORMANCE_HARNESS_TOKEN` (required at boot). Every `/conformance/*` request must include `Authorization: Bearer <token>`.
5. **Private URL pairing:** Boot fails when `CONFORMANCE_HARNESS_ENABLED=true`, `HTTP_CLIENT_ALLOW_PRIVATE_URLS=true`, and `NODE_ENV` is not `test`.

---

## SSRF Loopback Rule

The outbound HTTP probe (`POST /conformance/http-client`) allows test runners to instruct the server to execute outbound HTTP calls. To prevent this probe from being used as a Server-Side Request Forgery (SSRF) proxy against internal cloud services, cloud metadata endpoints (`169.254.169.254`), or external networks:

- Every incoming target URL is validated via `assertLoopbackTargetUrl` (`src/conformance/assert-loopback-target-url.ts`).
- **Protocol:** Must strictly be `http:`.
- **Host:** Must strictly match `127.0.0.1` or `localhost`.
- **Userinfo:** URLs containing embedded credentials (`username:password@`) are rejected.
- Any non-loopback or invalid destination immediately throws `400 Bad Request`:
  ```json
  {
    "statusCode": 400,
    "message": "targetUrl must be http://127.0.0.1 or http://localhost"
  }
  ```

---

## Route Catalog

All routes are mounted under the `/conformance` prefix.

### 1. Cache Probes (`/conformance/cache`)

| Method   | Route                     | Auth      | Description                                                                               |
| -------- | ------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `POST`   | `/conformance/cache`      | `@Public` | Dispatches a `CacheService.getOrSet` invocation with caller-defined cache & loader rules. |
| `DELETE` | `/conformance/cache/:key` | `@Public` | Invalidates and deletes the given cache key from both memory and Redis stores.            |

**`POST /conformance/cache` Request:**

```json
{
  "key": "test-key",
  "value": { "hello": "world" },
  "ttlMs": 5000,
  "negativeSoftTtlMs": 1000,
  "negativeHardTtlMs": 2000,
  "shouldCacheNull": false,
  "loaderDelayMs": 50,
  "loaderFailureCount": 0
}
```

**Response:**

```json
{
  "value": { "hello": "world" },
  "isFromLoader": true,
  "loaderCallCount": 1
}
```

### 2. HTTP Client Probe (`/conformance/http-client`)

| Method | Route                      | Auth      | Description                                                                    |
| ------ | -------------------------- | --------- | ------------------------------------------------------------------------------ |
| `POST` | `/conformance/http-client` | `@Public` | Dispatches an outbound request through `HttpClient` against a loopback target. |

**Request:**

```json
{
  "targetUrl": "http://127.0.0.1:4010/upstream/abc",
  "method": "POST",
  "headers": { "x-custom-test": "1" },
  "body": { "sample": true },
  "maxRetries": 3,
  "baseDelayMs": 50,
  "maxDelayMs": 1000,
  "jitter": true,
  "timeoutMs": 2000,
  "circuitBreaker": false,
  "propagateDeadline": true
}
```

**Response:**

```json
{
  "upstreamStatus": 200,
  "upstreamBody": { "sample": true },
  "attempts": 1,
  "errorName": null
}
```

### 3. Request Deadline Probe (`/conformance/deadline`)

| Method | Route                        | Auth      | Description                                                                         |
| ------ | ---------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `GET`  | `/conformance/deadline/slow` | `@Public` | Waits for `delayMs` while listening to request abort signal (`getRequestSignal()`). |

**Query Parameters:**

- `delayMs` (integer, default 0): Sleep duration in milliseconds.

**Response:**

```json
{
  "completedAfterMs": 102,
  "remainingBudgetMs": 4898
}
```

### 4. API Priority Shedding Probes (`/conformance/priority`)

| Method | Route                            | Auth      | Priority Tier | Description                                                                       |
| ------ | -------------------------------- | --------- | ------------- | --------------------------------------------------------------------------------- |
| `GET`  | `/conformance/priority/critical` | `@Public` | `Critical`    | Holds request for `holdMs` under `ApiPriorityLevel.Critical` admission threshold. |
| `GET`  | `/conformance/priority/high`     | `@Public` | `High`        | Holds request for `holdMs` under `ApiPriorityLevel.High` admission threshold.     |
| `GET`  | `/conformance/priority/normal`   | `@Public` | `Normal`      | Holds request for `holdMs` under `ApiPriorityLevel.Normal` admission threshold.   |
| `GET`  | `/conformance/priority/low`      | `@Public` | `Low`         | Holds request for `holdMs` under `ApiPriorityLevel.Low` admission threshold.      |

**Query Parameters:**

- `holdMs` (integer, default 0): Time to hold active in-flight slot.

**Response:**

```json
{
  "priority": "critical"
}
```

### 5. Rate Limiting Probes (`/conformance/rate-limit`)

| Method | Route                                 | Auth      | Identifier          | Limit   |
| ------ | ------------------------------------- | --------- | ------------------- | ------- |
| `GET`  | `/conformance/rate-limit/user`        | JWT Auth  | `UserId`            | 3 / 60s |
| `GET`  | `/conformance/rate-limit/fingerprint` | `@Public` | `DeviceFingerprint` | 3 / 60s |
| `GET`  | `/conformance/rate-limit/guest`       | `@Public` | `GuestId` (Cookie)  | 3 / 60s |

Exceeding the window quota returns HTTP `429 Too Many Requests` with a `Retry-After` header.

### 6. Log & Span Redaction Probe (`/conformance/redaction`)

| Method | Route                    | Auth      | Description                                                                                |
| ------ | ------------------------ | --------- | ------------------------------------------------------------------------------------------ |
| `POST` | `/conformance/redaction` | `@Public` | Emits Winston log line and returns log-redacted payload and scrubbed OTel span attributes. |

**Request:**

```json
{
  "payload": {
    "email": "user@example.com",
    "password": "secret-password",
    "metadata": { "token": "jwt-token-value" }
  }
}
```

**Response:**

```json
{
  "redactedPayload": {
    "email": "[REDACTED]",
    "password": "[REDACTED]",
    "metadata": { "token": "[REDACTED]" }
  },
  "redactedSpanAttributes": {
    "email": "[REDACTED]",
    "password": "[REDACTED]",
    "metadata.token": "[REDACTED]"
  }
}
```

---

## Configuration & Environment Profile

The conformance harness relies on a pinned environment configuration profile defined in [`.env.conformance.example`](../../.env.conformance.example). When running tests, merge `.env.conformance.example` over local `.env` settings.
