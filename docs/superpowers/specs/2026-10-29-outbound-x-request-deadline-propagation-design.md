# Outbound `x-request-deadline` propagation — design

**Date:** 2026-10-29  
**Status:** Approved for implementation planning  
**Related:** Inbound ALS + `mergeInboundDeadlineWithPolicy` (already shipped); combined roadmap Epic B in `docs/superpowers/plans/2026-10-29-otel-redaction-deadline-header-http-load-leveling.md`

## Problem

Request deadline middleware stores `deadlineAt` in ALS and exposes it on the **response** as `x-request-deadline`. Outbound `HttpClient` already merges the inbound **signal** and caps timeouts via `remainingMs()`, but it does **not** send `x-request-deadline` on downstream HTTP calls. Nest (or other) services that expect the header cannot align their deadline with the caller’s absolute cutoff.

## Goal

When an inbound HTTP handler has an active request-deadline ALS, optionally add `x-request-deadline: <deadlineAtMs>` on outbound `HttpClient` requests so internal downstreams can honor the same absolute deadline (in addition to signal/timeout inheritance).

## Non-goals

- Parsing inbound `x-request-deadline` on this service’s middleware (still uses timeout header + defaults today).
- Propagating to third-party APIs by default (`external` clients stay opt-in).
- New environment variables or global feature flags.
- Changing OTel redaction or load-leveling behavior.

## Behavior

| Condition                                                   | Outbound header                            |
| ----------------------------------------------------------- | ------------------------------------------ |
| No ALS / no `deadlineAt`                                    | Never set by propagation                   |
| `propagateHeader === false` (explicit policy)               | Never set                                  |
| `propagateHeader === true` (explicit)                       | Set when `getDeadlineAt()` defined         |
| Policy omitted, `identity.kind === 'internal'`              | Set when `getDeadlineAt()` defined         |
| Policy omitted, `identity.kind === 'external'`              | Not set                                    |
| Caller already set `x-request-deadline` (any casing in map) | **Do not override**; resolver returns `{}` |

**Header value:** decimal string of absolute epoch milliseconds (`String(deadlineAt)`), matching middleware response header format.

**Merge order in `ClientRuntime`:** default headers → per-request headers → request interceptors → idempotency header → **inbound signal/timeout merge** → **deadline header propagation** → timeout budget / transport.

Policy API: `ConfiguredHttpClient.addDeadlinePropagation({ propagateHeader?: boolean })` — same fluent pattern as `.addTimeout()`.

## Components

1. **`REQUEST_DEADLINE_HEADER`** constant in `request-deadline.constants.ts` (`'x-request-deadline'`).
2. **Pure resolver** `resolveOutboundDeadlineHeaders(...)` under `src/core/request-deadline/helpers/` (no Nest imports); unit-tested in isolation.
3. **`ClientPolicySnapshot.deadlinePropagation`** + runtime merge using `getDeadlineAt()`.
4. **Optional** `src/core/http-client/resilience/outbound-deadline-header.ts` re-export for symmetry with `inbound-deadline.ts` (not required on public `HttpClient` barrel unless useful for tests).

## Error handling

Pure resolver never throws. Runtime behavior unchanged when propagation is off or ALS absent.

## Testing

- Unit tests for resolver (propagate on/off, missing deadline, caller header present).
- `http-client.spec.ts` integration: internal client + ALS sends header; external default does not; external with `.addDeadlinePropagation({ propagateHeader: true })` sends header.

## Documentation

- Extend **Inbound deadline inheritance** in `docs/features/http_client.feature.md` with header propagation rules.
- Update `docs/features/features.md` checklist row (remove “not wired”).

## Success criteria

- `pnpm test:unit` passes for new and existing HttpClient/deadline tests.
- Internal downstream test server observes `x-request-deadline` equal to ALS `deadlineAt` when propagation applies.
