# PII and log redaction

## Scope

- **Winston logs** (all levels): metadata fields and message/stack strings pass through `createRedactionFormat` in `src/core/logger/logger.config.ts`.
- **HTTP access lines** from `LoggingInterceptor`: request URLs run through `redactUrl`.
- **HttpClient telemetry**: URL, header, and query redaction via `src/core/http-client/telemetry/redaction.ts` (re-exports `src/core/redaction/`).

## Configuration

| Env                     | Default          | Purpose                                                            |
| ----------------------- | ---------------- | ------------------------------------------------------------------ |
| `LOG_REDACTION_ENABLED` | enabled (`true`) | Set to `false` to disable app log redaction (local debugging only) |

## Behavior

- **Key-based:** field names matching sensitive patterns (password, token, email, apiKey, …) are replaced with `[REDACTED]`.
- **Value-based:** string values that look like email addresses or JWTs are redacted even when the key is benign.
- **URLs:** query parameters and userinfo matching HttpClient rules are scrubbed; safe params remain.

## Out of scope (for now)

- OpenTelemetry span attributes
- API JSON response bodies
- Persistent storage (Mongo/Postgres)

## Extending

Add keys in `src/core/redaction/sensitive-keys.ts` (`SENSITIVE_LOG_KEYS` or patterns) or value heuristics in `src/core/redaction/redact-value-patterns.ts`.
