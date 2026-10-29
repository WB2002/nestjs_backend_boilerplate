# Observability (tracing + 503 metrics)

## Tracing (OpenTelemetry + AWS X-Ray)

| Env                           | Default              | Purpose                                        |
| ----------------------------- | -------------------- | ---------------------------------------------- |
| `OTEL_ENABLED`                | `false`              | Enable Node SDK + HTTP instrumentation         |
| `OTEL_SERVICE_NAME`           | `nestjs-boilerplate` | Service name on spans                          |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset                | OTLP HTTP base (exporter appends `/v1/traces`) |

Bootstrap: `node -r ./dist/instrumentation.js dist/main` (see `package.json` `start:prod` and `Dockerfile`).

Export traces via **ADOT Collector** or **CloudWatch Agent** with the X-Ray backend. Outbound `HttpClient` uses `.addTracing()` for CLIENT spans and shared X-Ray propagation (`src/core/telemetry/xray-propagation.ts`).

### Health probe exclusion

ALB probes must not create X-Ray segments or pollute trace cost:

- `isTraceExemptPath()` mirrors `PRESSURE_EXEMPT_PATHS` (`/health`, `/health/ready`)
- HTTP instrumentation ignores those URLs
- `@SkipTracing()` on `HealthController`
- `TracingInterceptor` skips span enrichment on exempt routes

## App metrics (EMF)

| Env                   | Default | Purpose                                                |
| --------------------- | ------- | ------------------------------------------------------ |
| `APP_METRICS_ENABLED` | `true`  | Emit `Application` / `ServiceUnavailable` on 503 paths |

Alarm recipes: [cloudwatch-overload-alerts.md](../operations/cloudwatch-overload-alerts.md).

## Log redaction

Secrets and PII in Winston output, HTTP access logs, HttpClient trace attributes, and **OTLP span export** (`createRedactingSpanExporter`, gated by `LOG_REDACTION_ENABLED`): [pii_log_redaction.feature.md](./pii_log_redaction.feature.md).

## Modules

- `src/core/telemetry/` — config, EMF helpers, trace exempt paths, `@SkipTracing()`
- `src/core/redaction/` — shared redaction helpers (logs, HttpClient telemetry, OTel attributes)
- `src/instrumentation.ts` — OTel SDK preload entry
- `src/core/overload/overload-telemetry.ts` — overload 503 metric hooks
