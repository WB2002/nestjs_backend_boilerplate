# Features

This file provides a brief overview of all features currently supported by the `nestjs_backend_boilerplate`. For implementation details of any feature, refer to its dedicated doc linked below.

---

## Feature Index

| Feature        | Route prefix | Detail doc                                  |
| -------------- | ------------ | ------------------------------------------- |
| Authentication | `/auth`      | `docs/features/auth.feature.md`             |
| Health Check   | `/health`    | —                                           |
| HTTP Client    | —            | `docs/features/http_client.feature.md`      |
| Country Access | —            | `docs/features/country_access.feature.md`   |

---

## Authentication

Handles user registration, login, logout, and session management. Passwords are stored as hashes — never in plain text. Authentication is cookie-based using JWTs. All routes in the application are protected by default — unauthenticated access must be explicitly opted into using `@Public()`.

For full details see `docs/features/auth.feature.md`.

---

## Health Check

Exposes a single `GET /health` endpoint used by Docker and load balancers to confirm the application is running. No authentication required. Returns a status response indicating the application is alive.

---

## HTTP Client

Global outbound HTTP client provider under `src/core/http-client`. Supports immutable fluent configuration (`internal` / `external`), Axios transport, auth (API key, basic, bearer, OAuth client credentials, mTLS), resilience (retry, coalescing, circuit breaker, concurrency), normalized errors, OpenTelemetry/X-Ray tracing, CloudWatch EMF metrics, and NestJS shutdown hooks.

For full details see `docs/features/http_client.feature.md`.

---

## Country Access

Database-agnostic country allowlisting with local MaxMind GeoLite2 Country lookups, an in-memory snapshot, and a global Nest guard. Default persistence is PostgreSQL; MongoDB is a one-line repository swap. Request path never hits the database or a remote GeoIP API.

For full details see `docs/features/country_access.feature.md`.

---

## Adding a New Feature

When a new feature is added to the project, add it to the Feature Index table above and create a dedicated doc at `docs/features/<resource>_feature.md`. Link it in the table and in the entry.
