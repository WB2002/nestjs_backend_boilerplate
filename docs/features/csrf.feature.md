# CSRF Protection (Cookie-Based SPA)

## Overview

Browsers automatically attach `access_token` and `session_id` cookies on cross-site requests when policy allows. This feature adds **double-submit cookie** CSRF protection for **unsafe HTTP methods** whenever those session cookies are present and the client is **not** using `Authorization: Bearer`.

Native/mobile clients that send Bearer tokens only are unchanged.

## Mechanism

| Piece | Value |
| ----- | ----- |
| Readable cookie | `csrf_token` (not httpOnly; SameSite=strict) |
| Request header | `X-CSRF-Token` (must match cookie value) |
| Comparison | Constant-time (`crypto.timingSafeEqual`) |
| Failure | **403** with `code: CSRF_VALIDATION_FAILED` |

Validation runs on Fastify **`onRequest`** (after `@fastify/cookie` parses cookies), matching the pattern used by `GuestIdMiddleware`.

## When CSRF is enforced

All of the following must be true:

1. `CSRF_ENABLED` is not `false`
2. Method is `POST`, `PUT`, `PATCH`, or `DELETE`
3. Request includes `access_token` and/or `session_id` cookie
4. No `Authorization: Bearer …` header
5. Path is not exempt (`/health`, `/health/ready`, plus `CSRF_EXEMPT_PATHS`)

`GET`, `HEAD`, and `OPTIONS` are never checked. Anonymous POST bodies without session cookies (e.g. first visit before login) are not checked.

## SPA bootstrap

1. On app load, call **`GET /auth/csrf`** with `credentials: 'include'`.
2. Store `csrfToken` from the JSON body (and/or read `csrf_token` from `document.cookie`).
3. Send **`X-CSRF-Token`** on every mutating request with `credentials: 'include'`.
4. After **login** or **refresh**, update the in-memory token from the response `csrfToken` field (cookie is rotated server-side).

Example:

```typescript
const { csrfToken } = await fetch('/auth/csrf', { credentials: 'include' }).then(
  (r) => r.json(),
);

await fetch('/auth/logout', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'X-CSRF-Token': csrfToken,
    'Content-Type': 'application/json',
  },
});
```

## GraphQL

Browser clients posting to **`POST /graphql`** with cookie auth must send the same `X-CSRF-Token` header. Middleware runs once per HTTP request (not per resolver).

## Configuration

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `CSRF_ENABLED` | `true` | Set to `false` to disable (local experiments only) |
| `CSRF_EXEMPT_PATHS` | — | Comma-separated paths **appended** to default health exemptions |

## Module layout

- `src/core/csrf/` — token service, middleware, module
- Wired in `AppModule` after `GuestIdMiddleware` (Nest chain) with enforcement on Fastify `onRequest`
- `AuthController` — `GET /auth/csrf`, rotates token on login/refresh

## Related docs

- [auth.feature.md](./auth.feature.md) — cookie transport and session flow
