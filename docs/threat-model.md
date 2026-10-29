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

## Open items

- Complete STRIDE/LINDDUN pass when forking this boilerplate for a specific product and data classification.
