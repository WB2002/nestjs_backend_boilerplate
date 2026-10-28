# CloudWatch alarms — 503 overload metrics

Application code emits **Embedded Metric Format (EMF)** logs for service-unavailable responses.

## Metric shape

| Field | Value |
| ----- | ----- |
| Namespace | `Application` |
| Metric name | `ServiceUnavailable` |
| Unit | Count |
| Dimension | `Reason` |

### `Reason` values

| Reason | Source |
| ------ | ------ |
| `under_pressure` | `@fastify/under-pressure` shedding |
| `inbound_bulkhead` | `InboundBulkheadMiddleware` / `OverloadRejectedError` |
| `graphql_concurrency` | GraphQL Redis concurrency deny |
| `health_check` | Terminus `/health` or `/health/ready` **503** (metrics only — no X-Ray on probes) |
| `dependency_unavailable` | DB connection errors mapped to **503** |

Properties (not dimensions): `Path`, `PressureType` (under-pressure only).

## Recommended alarms

Create **one alarm per high-signal `Reason`**, plus optional ALB correlation.

### Under-pressure (critical)

- **Metric:** `Application` → `ServiceUnavailable`, Sum, period **60s**, dimension `Reason=under_pressure`
- **Threshold:** ≥ **5** for **2** consecutive periods
- **Action:** SNS topic `ops-high`

### Inbound bulkhead (warning / capacity)

- **Metric:** same, `Reason=inbound_bulkhead`
- **Threshold:** ≥ **1** for **5** consecutive periods (5 minutes)
- **Action:** SNS `ops-warning` — scale out or raise `INBOUND_MAX_IN_FLIGHT`

### GraphQL concurrency

- **Metric:** `Reason=graphql_concurrency`
- **Threshold:** ≥ **10** / 5 min
- **Action:** review `GQL_MAX_CONCURRENCY` and downstream latency

## ALB correlation

On the same dashboard, plot:

- `AWS/ApplicationELB` → `HTTPCode_ELB_503_Count` (target group)
- Sum of `Application` / `ServiceUnavailable` by `Reason`

If ALB 503 rises but app `under_pressure` / `inbound_bulkhead` stay flat, investigate edge or dependency health. See [edge-vs-app-rate-limits.md](./edge-vs-app-rate-limits.md).

## Tracing (X-Ray / OTel)

- Set `OTEL_ENABLED=true`, `OTEL_SERVICE_NAME`, and `OTEL_EXPORTER_OTLP_ENDPOINT` (ADOT or CloudWatch Agent sidecar).
- **`/health` and `/health/ready` are excluded** from trace export (instrumentation ignore hooks + `@SkipTracing()` on `HealthController`).
