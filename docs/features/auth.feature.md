# Auth Feature

## Overview

This feature implements email and password based authentication. Passwords are hashed with Argon2id. User sessions are stored in a MongoDB `sessions` collection. Only an **access token** is issued to the client — there is no refresh token. Instead, each session document holds a `token` field containing a UUID. This UUID is stored in a `session_id` httpOnly cookie and acts as the long-lived credential used to renew the access token when it expires. On every refresh the UUID is replaced with a newly generated one in a single atomic database operation, which is how replay attacks are prevented. Access tokens are signed with an asymmetric RS256 key pair. Sessions are rolling — their expiry is extended on every successful refresh.

---

## Security Model

| Concern                      | Decision                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password storage             | Argon2id with OWASP-recommended parameters (64 MiB memory, 3 iterations, 4 lanes)                                                                                                                                                                                                                                                |
| JWT algorithm                | RS256 — private key signs tokens on the server; public key can be distributed to downstream services for verification without sharing the private key                                                                                                                                                                            |
| Long-lived credential        | A `session_id` httpOnly cookie containing a UUID stored in the session document's `token` field. This is an opaque random value the client cannot read or tamper with                                                                                                                                                            |
| Replay prevention on refresh | On every refresh, a single atomic `findOneAndUpdate` matches the session by its current `token` UUID, replaces it with a freshly generated UUID, and updates `expiresAt`. A concurrent attempt with the old UUID matches nothing and gets a 401. No document is deleted or recreated — this is a lighter, fully atomic operation |
| Session revocation           | On logout, the session `token` UUID is written to a Redis set with a TTL equal to `ACCESS_TOKEN_TTL`. The JWT Strategy checks this set on every request. After `ACCESS_TOKEN_TTL` seconds the access token expires on its own, so the Redis entry is no longer needed and is automatically removed                               |
| Access token payload         | Contains `sub` (userId), `email`, `role`, and `jti` (the session `token` UUID). The JWT Strategy uses `jti` for revocation (short-TTL cache via `CacheService`) and trusts embedded `role` on the hot path; Mongo role lookups run at login/refresh and on legacy tokens missing `role`                                          |
| Token transport — web        | The `access_token` and `session_id` are delivered as `httpOnly, Secure, SameSite=Strict` cookies. The browser attaches them automatically and JavaScript cannot read them                                                                                                                                                        |
| CSRF (web)                   | Double-submit cookie: readable `csrf_token` plus `X-CSRF-Token` on POST/PUT/PATCH/DELETE when session cookies are sent. Bootstrap via `GET /auth/csrf`; rotated on login/refresh. See [csrf.feature.md](./csrf.feature.md)                                                                                                       |
| Token transport — mobile     | The `access_token` is also returned in the JSON response body so native apps can store it in Keychain or Keystore and send it as an `Authorization: Bearer` header. The `session_id` is returned in the body as well so mobile apps can store it and send it as a custom header on refresh requests                              |
| Access token lifetime        | Short-lived (15 minutes)                                                                                                                                                                                                                                                                                                         |
| Session lifetime             | Rolling from `SESSION_TTL` (e.g. 7 days), extended on every successful refresh                                                                                                                                                                                                                                                   |
| Session cleanup              | MongoDB TTL index on `expiresAt` automatically deletes expired session documents, which passively invalidates the corresponding `session_id`                                                                                                                                                                                     |

---

## Dependencies

The following packages need to be added:

- `@nestjs/passport` and `@nestjs/jwt` — NestJS wrappers for Passport and JWT
- `passport` and `passport-local` — core Passport library plus the local strategy for email/password
- `argon2` — Argon2id password hashing
- `@fastify/cookie` — cookie parsing and signing on the Fastify adapter
- Type packages: `@types/passport-local` and `@types/passport`

---

## Environment Variables

The following variables must be added to `.env` and `.env.example`:

- `JWT_PRIVATE_KEY` — the RSA private key used to sign access tokens. Generated with `openssl genrsa -out private.pem 4096`. Store newlines as `\n` in the env value or load from a file.
- `JWT_PUBLIC_KEY` — the corresponding RSA public key. Generated with `openssl rsa -in private.pem -pubout -out public.pem`.
- `ACCESS_TOKEN_TTL` — access token lifetime in seconds (e.g. 900 for 15 minutes).
- `SESSION_TTL` — session lifetime in seconds (e.g. 604800 for 7 days).
- `COOKIE_SECRET` — a random secret used to sign cookies to detect client-side tampering.

The private key must never be committed to source control. In production it should be stored in a secrets manager such as AWS Secrets Manager or HashiCorp Vault.

---

## Module Structure

All auth code lives under `src/auth/`. The directory contains the following files:

- `auth.module.ts` — declares and wires together all auth providers
- `auth.controller.ts` — exposes the four HTTP endpoints
- `auth.service.ts` — contains all business logic (registration, credential validation, session creation, rolling refresh, logout)
- `constants/cookie.constants.ts` — defines cookie names and cookie option objects (httpOnly, Secure, SameSite, path scoping)
- `decorators/public.decorator.ts` — a `@Public()` decorator that opts a route out of the global JWT guard
- `dto/register.dto.ts` and `dto/login.dto.ts` — validated request body shapes
- `guards/jwt-auth.guard.ts` — the global guard that protects all routes unless marked `@Public()`
- `guards/local-auth.guard.ts` — used only on the login endpoint to trigger Passport's local strategy
- `schemas/user.schema.ts` — Mongoose schema for the `users` collection
- `schemas/session.schema.ts` — Mongoose schema for the `sessions` collection
- `strategies/local.strategy.ts` — Passport strategy that validates email and password
- `strategies/jwt.strategy.ts` — Passport strategy that validates the access token from either the cookie or Bearer header
- `types/auth-request.interface.ts` — extends FastifyRequest with the authenticated user object

---

## Database Schemas

### Users Collection

Stores one document per registered user. Fields: `email` (unique, lowercased, trimmed), `passwordHash` (the Argon2id output), `isActive` (boolean, defaults to true), and `role` (`admin` | `user`, defaults to `user`). Emails listed in `FEATURE_FLAG_ADMIN_EMAILS` are assigned `admin` on register and promoted on login/refresh. Timestamps (`createdAt`, `updatedAt`) are enabled automatically.

### Sessions Collection

Stores one document per active login session. Fields:

- `userId` — reference to the user who owns the session
- `token` — a UUID v4 string, indexed for fast lookup. This is the value stored in the `session_id` cookie. It is replaced with a new UUID on every refresh.
- `userAgent` — the User-Agent header captured at login time
- `ip` — the IP address captured at login time
- `expiresAt` — the datetime when the session expires; indexed with `expireAfterSeconds: 0` so MongoDB auto-deletes the document when this time passes
- `createdAt` — the time the session was first created

The `token` field is the only thing that changes during a session's lifetime. All other fields remain stable. The MongoDB `_id` is never exposed to the client.

---

## Cookies

Two cookies are used:

- `access_token` — scoped to `path: /`. Contains the short-lived RS256 JWT. The JWT guard reads this on every authenticated call. Also returned in the response body for mobile clients.
- `session_id` — scoped to `path: /auth/refresh`. Contains the current UUID from the session's `token` field. This is the long-lived credential. It is only ever sent to the refresh endpoint because of path scoping. Also returned in the response body for mobile clients.

Both cookies use `httpOnly: true`, `secure: true` (HTTPS only in production), and `sameSite: strict`. Cookies are signed with `COOKIE_SECRET` to detect tampering.

---

## Strategies

### Local Strategy

Used only on the login endpoint. It extracts `email` and `password` from the request body, calls the auth service to find the user and verify the password with Argon2 `verify`. If valid, it returns the user document, which Passport attaches to `request.user`. If invalid, it throws a 401.

### JWT Strategy

Used on every protected endpoint via the global guard. It tries two token sources in order:

1. The `access_token` httpOnly cookie (web browsers)
2. The `Authorization: Bearer <token>` header (native mobile apps)

The first non-null value is used. The token is verified with the RS256 public key. After signature verification succeeds, the strategy extracts the `jti` claim from the payload and checks Redis for a key matching that UUID. If the key exists, the session has been revoked and the request is rejected with a 401. If the key is absent, the payload (`sub`, `email`, `jti`) is attached to `request.user`.

---

## Guards and Decorators

### Global JWT Guard

Registered as an `APP_GUARD` in `AppModule` so it applies to every route by default. Before invoking Passport it checks for the `@Public()` metadata flag; if present the route is allowed through without a token.

### Local Auth Guard

Applied manually only to `POST /auth/login`. It triggers `passport-local`, which calls the Local Strategy.

### `@Public()` Decorator

Marks a route as publicly accessible. Applied to `POST /auth/register`, `POST /auth/login`, and `POST /auth/refresh` (because the access token is expired when the client hits refresh).

---

## Auth Service Responsibilities

### Registration

Checks if the email is already in use. If not, hashes the password with Argon2id and creates a new user document.

### Credential Validation

Looks up the user by email and checks `isActive`. Runs `argon2.verify` to compare the submitted password against the stored hash. Returns the user document on success or null on failure. Called by the Local Strategy.

### Session Creation

Generates a UUID v4 for the `token` field. Creates a new session document with `userId`, `token`, `userAgent`, `ip`, and `expiresAt` (current time + `SESSION_TTL`). Signs an access token containing `sub: userId`, `email`, and `jti: token UUID` with an expiry of `ACCESS_TOKEN_TTL`. The standard `jti` claim allows the JWT Strategy to perform a revocation check on every request. Returns the access token and the UUID. No refresh token is generated.

### Rolling Refresh

Reads the `session_id` UUID from either the cookie (web) or the request body (mobile). Calls `findOneAndUpdate` with the filter `{ token: incomingUUID, expiresAt: { $gt: now } }` and the update `{ token: newUUID, expiresAt: newExpiry }`. This is a single atomic operation — if the UUID has already been rotated by a concurrent request, no document is matched and a 401 is returned. On success, signs and returns a new access token along with the new UUID. The `session_id` cookie is updated with the new UUID.

### Logout

Reads the `session_id` UUID from the cookie or request body. Looks up and deletes the session document where `token` matches. Then writes the UUID to a Redis key with TTL equal to `ACCESS_TOKEN_TTL` seconds. This covers the window where the access token is still cryptographically valid but the session is gone. Any request made with that access token during this window will be rejected by the revocation check in the JWT Strategy. After `ACCESS_TOKEN_TTL` seconds the access token expires on its own and the Redis entry is automatically removed. The controller clears both cookies.

---

## Auth Controller Endpoints

### `POST /auth/register` — Public

Accepts `email` and `password`. Delegates to the service. Returns 201 on success.

### `POST /auth/login` — Public, Local Guard

The Local Guard validates credentials first. On success, the service generates a UUID, creates a session document, and signs an access token. The response sets the `access_token` and `session_id` (UUID) httpOnly cookies, and also returns both values in the JSON response body for mobile clients.

### `POST /auth/refresh` — Public

The access token is expired so this route is `@Public()`. The `session_id` UUID is read from either the httpOnly cookie (web, sent automatically) or a `sessionId` field in the request body (mobile). A single `findOneAndUpdate` atomically replaces the `token` UUID with a freshly generated one and extends `expiresAt`. A new access token is signed. The cookies and response body are updated with the new UUID and access token.

### `POST /auth/logout` — Protected

Requires a valid access token. The `session_id` is read from the cookie or request body. The session document is deleted. Both cookies are cleared.

### `GET /auth/csrf` — Public

Issues a new CSRF token, sets the `csrf_token` cookie (readable by JavaScript), and returns `{ csrfToken }`. SPAs should call this before the first mutating request when using cookie auth.

---

## Wiring into AppModule

- Register `@fastify/cookie` on the Fastify instance inside `bootstrap()` in `main.ts`, passing `COOKIE_SECRET` as the signing secret.
- Import `AuthModule` into `AppModule`.
- Register `JwtAuthGuard` as a global `APP_GUARD` in `AppModule`.

---

## Session Flow

**Login (web and mobile)**

1. Client sends email and password.
2. Server validates credentials using Argon2id, creates a session document, and signs an access token.
3. Server sets `access_token` and `session_id` as httpOnly cookies and also returns both in the JSON body.
4. Web browser stores both in cookies automatically. Mobile app reads the body and saves both in secure storage.

**Authenticated Request**

- Web: browser automatically attaches the `access_token` cookie.
- Mobile: app reads the access token from secure storage and sends it as `Authorization: Bearer <token>`.
- Server's JWT Strategy finds the token, verifies it with the public key, and attaches the user to the request.

**Token Refresh**

1. Access token has expired. Client calls `POST /auth/refresh`.
2. Web: browser sends the `session_id` cookie automatically (path-scoped to `/auth/refresh`). Mobile: app sends `{ "sessionId": "..." }` in the request body.
3. Server runs a single atomic `findOneAndUpdate`: filter is `{ token: incomingUUID, expiresAt: { $gt: now } }`, update sets `token` to a new UUID and `expiresAt` to `now + SESSION_TTL`.
4. If no document matches (UUID already rotated or session expired), a 401 is returned — replay prevented.
5. Server signs a new access token, updates the `session_id` cookie with the new UUID, and returns both in the response body.
6. Mobile app updates its stored `sessionId` and `accessToken` with the new values.

**Logout**

1. Client calls `POST /auth/logout` with the access token and the `session_id` (cookie or body).
2. Server deletes the session document.
3. Server clears both cookies.

---

## Security Considerations

- Argon2id parameters follow OWASP recommendations. Tune `memoryCost` down if the server has limited RAM, but never below 19 MiB.
- RS256 lets downstream micro-services verify access tokens with only the public key — the private key never leaves the auth server.
- Rotating the `token` UUID on every refresh via a single atomic `findOneAndUpdate` is strictly better than delete-and-recreate: it is one database operation instead of two, the session document and its history are preserved, and there is no race window between the delete and the insert.
- The `token` field should have a unique index in MongoDB to guarantee no two sessions ever share the same UUID, even in the astronomically unlikely event of a UUID collision.
- The Redis revocation set is kept minimal by design: entries live only as long as `ACCESS_TOKEN_TTL`. After that the JWT itself expires and the cryptographic check rejects it, so the Redis entry is redundant and is automatically cleaned up. This means the revocation set never grows unboundedly.
- The `jti` claim inside the access token is the bridge between the stateless JWT and the stateful revocation check. Without it the JWT Strategy would have no way to know which session issued the token. Using the standard `jti` claim (rather than a custom field) also aligns with RFC 7519.
- The `session_id` cookie is path-scoped to `/auth/refresh` so it is never accidentally sent to other endpoints.
- The MongoDB TTL index is a passive safety net for expired sessions. Active revocation happens via `findOneAndDelete` on logout and the corresponding Redis entry covers the remaining access token window.
- To invalidate all sessions for a user (logout from all devices), delete all session documents where `userId` matches and write all their `token` UUIDs to Redis with `ACCESS_TOKEN_TTL` as the TTL. Expose this as `DELETE /auth/sessions` if needed.
- Never commit `JWT_PRIVATE_KEY` or `COOKIE_SECRET` to source control.
