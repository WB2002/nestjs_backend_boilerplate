# Non-functional requirements

Measurable targets for this boilerplate. Feature-specific SLOs live in `docs/features/*` and `docs/operations/*`.

## SLOs

- API availability: design for multi-instance deployment behind ALB (see `docs/operations/alb-multi-vm.md`)
- Overload: inbound load leveling and shedding documented in feature docs; CloudWatch alert patterns in `docs/operations/cloudwatch-overload-alerts.md`

## Latency budgets

- Request deadline propagation via `X-Request-Deadline` (see `intent/outbound-x-request-deadline-propagation/`)
- HTTP client adaptive concurrency and bulkheads (see `docs/features/http_client.feature.md`)

## Retention

- Logs: PII redaction required (`docs/features/pii_log_redaction.feature.md`)
- Job and session retention: per-module feature docs and env configuration

## Compliance

- Threat modeling stub: `docs/threat-model.md`
- Security CI layering: `intent/source-security-ci-layering/`
