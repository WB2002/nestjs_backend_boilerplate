# Security audit report — 2026-11-21 (repository-wide)

## Executive verdict

**FAIL (ACTION REQUIRED)** — 2 confirmed **High** and 1 confirmed **Medium** findings require remediation before treating a production fork as security-baseline complete.

## Coverage ledger summary

| Metric        | Value |
| ------------- | ----: |
| Units mapped  |    25 |
| Units audited |    25 |
| Coverage      |  100% |

Ledger: [coverage-ledger.json](./coverage-ledger.json)

Threat classes applied per unit: **SEC-AUTH**, **SEC-AUTHZ**, **SEC-INJ**, **SEC-EGRESS**, **SEC-SHARP**, **SEC-OPS**.

## Confirmed findings

### SEC-AUD-001 — GraphiQL enabled in production (High)

- **Location:** `src/app.module.ts:201`
- **Exploit:** Public GraphiQL against `/graphql` in any deployment using default `GraphQLModule` options; aids schema discovery and lowers cost of attacking future protected fields.
- **Disprover:** No environment-based toggle or auth gate found on `graphiql: true`.
- **Remediation:** Disable GraphiQL (and introspection) when `NODE_ENV=production`; use env-driven config and document in ops runbooks.

### SEC-AUD-002 — Public background job enqueue (High)

- **Location:** `src/example/example-jobs.controller.ts:21`
- **Exploit:** `POST /example/jobs/echo` with no JWT when `BACKGROUND_JOBS_ENABLED` registers `ExampleJobsModule` → queue flooding and worker abuse.
- **Disprover:** `@Public()` explicitly bypasses `JwtAuthGuard`; rate limits do not substitute for authentication.
- **Remediation:** Remove public access; disable example job routes in production builds or behind explicit feature flag default-off.

### SEC-AUD-003 — Stale JWT role authorization (Medium)

- **Location:** `src/auth/access-token-authenticator.service.ts:48`
- **Exploit:** After DB role demotion, bearer token retains embedded `role` until TTL/refresh (affects feature-flags admin and WS `admin-broadcast`).
- **Disprover:** Revocation covers session JTI only, not role changes.
- **Remediation:** Reconcile role from authoritative store on authentication or include invalidating role version in token lifecycle.

## Needs validation (runtime / ops)

| ID          | Title                                                                                             | Owner action                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SEC-AUD-004 | HTTP CORS wildcard when `ALLOWED_ORIGINS` unset (`src/main.ts:145`)                               | Confirm production env always sets explicit origins; align with WebSocket production guard.                    |
| SEC-AUD-005 | Conformance loopback HTTP on staging (`src/conformance/conformance-http-client.controller.ts:10`) | Confirm harness never exposed on internet-facing staging; audit pairing with `HTTP_CLIENT_ALLOW_PRIVATE_URLS`. |
| SEC-AUD-006 | Detailed public `/health` (`src/core/health/health.controller.ts:78`)                             | Confirm probes are internal/ALB-only in your network layout.                                                   |

## Rejected candidates log

| ID          | Title                                     | Disprover summary                                          |
| ----------- | ----------------------------------------- | ---------------------------------------------------------- |
| SEC-AUD-007 | Access token in login JSON                | Requires XSS; httpOnly cookies primary for browsers.       |
| SEC-AUD-008 | No auth-specific rate limit               | Global IP limit + Argon2 bulkhead; edge limits documented. |
| SEC-AUD-009 | GraphQL category IDOR                     | In-memory demo, no tenant data.                            |
| SEC-AUD-010 | SSRF via `HTTP_CLIENT_ALLOW_PRIVATE_URLS` | Operator env only, not attacker-controlled.                |
| SEC-AUD-011 | WebSocket query token leak                | `WEBSOCKET_ALLOW_QUERY_TOKEN` defaults off.                |
| SEC-AUD-012 | Malicious upload RCE                      | JWT required; no static serving; optional ClamAV.          |

Full structured list: [findings.json](./findings.json)

## Threat model updates required

Add to `docs/threat-model.md` (human-owned):

1. **GraphQL GraphiQL / introspection** as an internet-facing entry when enabled.
2. **Example modules** (`/example/jobs`, captcha, notification) as non-production surfaces unless explicitly hardened.
3. **Conformance harness** routes when `CONFORMANCE_HARNESS_ENABLED=true` (non-production only by env validation).
4. **JWT role staleness** abuse case for admin/feature-flag and WebSocket admin channels.
5. **HTTP vs WebSocket CORS** divergence (`main.ts` vs `parseWebSocketConfig` / `assertWebSocketProductionOrigins`).

## Method

Read-only multi-phase audit per `.cursor/skills/security-audit/SKILL.md`. Disprover gate executed inline for each candidate (discovery pass separate from validation). No application code or threat model was modified.

## Artifacts

- [coverage-ledger.json](./coverage-ledger.json)
- [findings.json](./findings.json)
- This report
