---
title: Captcha (hCaptcha)
directory: docs/features
task_type: feature
created: 2026-08-20
---

# Captcha Feature

Reusable server-side CAPTCHA verification with an hCaptcha provider. Feature modules depend on `CaptchaService`, not on hCaptcha-specific types. Auth, signup, login, and other business APIs are **not** wired to CAPTCHA yet — only a demo endpoint exists.

---

## Overview

- **Abstraction:** `CaptchaService.verify(token, options?)` → `{ success, errorCodes? }`
- **Provider:** `HCaptchaService` calls hCaptcha’s siteverify API over the shared `HttpClient`
- **Secret:** `HCAPTCHA_SECRET` stays on the backend only — never returned, logged, or accepted from clients
- **Site key:** `HCAPTCHA_SITE_KEY` is public for frontend widgets (documented only; no config API)

---

## Environment Variables

Add to `.env` (see `.env.example`):

```bash
HCAPTCHA_SITE_KEY=your-public-site-key
HCAPTCHA_SECRET=your-server-secret
# Optional:
# HCAPTCHA_VERIFY_BASE_URL=https://api.hcaptcha.com
```

| Variable | Public? | Purpose |
| --- | --- | --- |
| `HCAPTCHA_SITE_KEY` | Yes | Frontend widget / client rendering |
| `HCAPTCHA_SECRET` | **No** | Server-to-server siteverify only |
| `HCAPTCHA_VERIFY_BASE_URL` | N/A | Override verification API origin (default `https://api.hcaptcha.com`) |

Missing or empty `HCAPTCHA_SECRET` causes `CaptchaModule` construction to fail (`CaptchaConfigurationError`). The app will not start until it is set.

**Local development:** use [hCaptcha test keys](https://docs.hcaptcha.com/#integration-testing-test-keys). Never commit real secrets.

---

## Verification Flow

1. Frontend renders hCaptcha with `HCAPTCHA_SITE_KEY`
2. User completes the challenge and receives a token
3. Frontend sends the token to the backend as `captchaToken`
4. Backend calls `CaptchaService.verify(token, { remoteIp })`
5. `HCaptchaService` POSTs `secret`, `response`, and optional `remoteip` to `/siteverify`
6. Result is normalized to `{ success, errorCodes? }`; infrastructure failures throw typed errors

Client IP is taken from Fastify `req.ip` (respect `TRUST_PROXY` in production). Do not parse `X-Forwarded-For` in captcha code.

```ts
const result = await captchaService.verify(captchaToken, { remoteIp });
if (!result.success) {
  // reject request (e.g. 400)
}
```

---

## Endpoints

### `POST /example/captcha`

Demo-only. `@Public()`. Does **not** integrate with auth.

**Request**

```json
{
  "captchaToken": "<token-from-hcaptcha-widget>"
}
```

**Success (200)**

```json
{
  "message": "Captcha verification successful"
}
```

**Failure**

| Case | Status | Message (via global exception filter) |
| --- | --- | --- |
| Missing / invalid body field | 400 | Validation message |
| Token rejected by provider | 400 | `Captcha verification failed` |
| Timeout / provider / malformed | 503 | `Captcha verification unavailable` |
| Misconfiguration | 500 | `Internal server error` |

**curl**

```bash
curl -sS -X POST http://localhost:3000/example/captcha \
  -H 'Content-Type: application/json' \
  -d '{"captchaToken":"TOKEN"}'
```

---

## Frontend Integration

1. Load the hCaptcha widget with `HCAPTCHA_SITE_KEY` (from the frontend env, not from this API)
2. Let the user complete the challenge
3. Read the resulting token from the widget callback
4. Send it to the backend:

```http
POST /example/captcha
Content-Type: application/json

{ "captchaToken": "<token>" }
```

Never send `HCAPTCHA_SECRET` from the browser. Never trust a client-side `captchaValid` flag — the backend always verifies with hCaptcha.

---

## Module Structure

```
src/core/captcha/
├── captcha.module.ts
├── captcha.service.ts          # abstract CaptchaService
├── captcha.types.ts
├── captcha.errors.ts
├── captcha.constants.ts
├── hcaptcha.service.ts
├── hcaptcha.service.spec.ts
└── index.ts

src/example/
├── example.module.ts
├── example-captcha.controller.ts
├── example-captcha.controller.spec.ts
└── dto/
    ├── example-captcha.dto.ts
    └── index.ts
```

DI binding: `{ provide: CaptchaService, useClass: HCaptchaService }`. Controllers inject `CaptchaService` only.

Outbound HTTP: `HttpClient.external('hcaptcha')` with a 5s timeout, **no retry**, tracing/metrics/logging enabled. Form body uses the client’s `formData` (URL-encoded).

---

## Error Distinctions (internal)

| Condition | Type / result |
| --- | --- |
| Token invalid / empty | `{ success: false, errorCodes? }` |
| Provider timeout | `CaptchaTimeoutError` |
| Network / HTTP failure | `CaptchaProviderUnavailableError` |
| Malformed JSON body | `CaptchaMalformedResponseError` |
| Missing secret | `CaptchaConfigurationError` |

Public responses never include the secret, raw provider body, or stack traces.

---

## Observability

`HCaptchaService` logs structured outcomes only:

- `verification_success`
- `verification_failed` (+ `errorCodes` when present)
- `provider_failure`
- `timeout`

Never log CAPTCHA tokens, secrets, passwords, or full client IPs.

---

## Testing

Unit tests mock `HttpClient` / `post` — **no real network calls**.

```bash
pnpm exec jest --watchman=false --watchAll=false \
  src/core/captcha/hcaptcha.service.spec.ts \
  src/example/example-captcha.controller.spec.ts
```

Coverage includes success, failure + error codes, HTTP 4xx/5xx, network error, timeout, malformed body, missing secret, and example API validation / success / failure / provider down.

---

## Non-Goals

Not implemented (by design): login/signup/payment integration, rate limiting specific to CAPTCHA, bot/VPN scoring, Redis/DB token storage, or CAPTCHA caching.

---

## Related Files

- `src/core/captcha/` — reusable captcha core
- `src/example/` — demo endpoint only
- `src/core/http-client/` — outbound HTTP
- `.env.example` — env templates
- `docs/features/http_client.feature.md` — HTTP client usage
