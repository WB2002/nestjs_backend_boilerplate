# Threat model

High-level security surface for the boilerplate. Detail per feature in `docs/features/` and Semgrep rules under `semgrep/`.

## Assets

- User credentials and session tokens (auth, CSRF, WebSocket auth)
- PII in logs and payloads (redaction requirements)
- Redis and database contents
- Outbound HTTP to third parties

## Trust boundaries

- Internet → ALB / edge → Nest application
- Application → MongoDB, Postgres, Redis, external HTTP APIs

## Controls

- Semgrep and app-security quality jobs
- Gitleaks on commit; supply-chain scans in CI
- CSRF, captcha, country access, feature flags as documented modules

## Internet-facing misconfiguration (audit remediations)

| Surface             | Risk                                            | Mitigation                                                                                                  |
| ------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| GraphQL `/graphql`  | GraphiQL and introspection aid schema discovery | Disabled when `NODE_ENV=production` (`parseGraphQlDriverOptions`)                                           |
| Example modules     | Demo routes enqueue work or bypass auth         | `POST /example/jobs/echo` requires JWT; API module off in production unless `EXAMPLE_JOBS_API_ENABLED=true` |
| Conformance harness | Staging SSRF / loopback proxy when enabled      | Not loadable in production; `CONFORMANCE_HARNESS_TOKEN` + bearer guard on all `/conformance/*`              |
| JWT access tokens   | Stale `role` claim after DB demotion            | `AccessTokenAuthenticator` loads role from MongoDB each request                                             |
| HTTP CORS           | Wildcard origins with credentials               | `resolveCorsOrigins` + `ALLOWED_ORIGINS` required in production (aligned with WebSocket guard)              |
| Public `/health`    | Dependency topology leak                        | Production returns minimal body unless `HEALTH_EXPOSE_DEPENDENCIES=true`                                    |

## Security baseline environment

| Variable                     | Purpose                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`            | Required comma-separated list when `NODE_ENV=production` (HTTP + WebSocket)     |
| `EXAMPLE_JOBS_API_ENABLED`   | Opt-in demo job enqueue HTTP in production (default off)                        |
| `CONFORMANCE_HARNESS_TOKEN`  | Required when `CONFORMANCE_HARNESS_ENABLED=true`                                |
| `HEALTH_EXPOSE_DEPENDENCIES` | Set `true` to expose full Terminus dependency detail on `/health` in production |

## Open items

- Complete STRIDE/LINDDUN pass when forking this boilerplate for a specific product and data classification.
