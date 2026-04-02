# Features

This file provides a brief overview of all features currently supported by the `nestjs_backend_boilerplate`. For implementation details of any feature, refer to its dedicated doc linked below.

---

## Feature Index

| Feature        | Route prefix | Detail doc                      |
| -------------- | ------------ | ------------------------------- |
| Authentication | `/auth`      | `docs/features/auth_feature.md` |
| Health Check   | `/health`    | —                               |

---

## Authentication

Handles user registration, login, logout, and session management. Passwords are stored as hashes — never in plain text. Authentication is cookie-based using JWTs. All routes in the application are protected by default — unauthenticated access must be explicitly opted into using `@Public()`.

For full details see `docs/features/auth_feature.md`.

---

## Health Check

Exposes a single `GET /health` endpoint used by Docker and load balancers to confirm the application is running. No authentication required. Returns a status response indicating the application is alive.

---

## Adding a New Feature

When a new feature is added to the project, add it to the Feature Index table above and create a dedicated doc at `docs/features/<resource>_feature.md`. Link it in the table and in the entry.
