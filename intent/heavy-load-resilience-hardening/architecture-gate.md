# Architecture gate: Heavy-load resilience hardening (Task 4: JTI Revocation Resilience)

Source: intent/heavy-load-resilience-hardening/spec.md
Status: draft
Lifecycle: DRAFT
Recommendation: PASS

## Checklist

- Requirements complete: REQ-004 specifies local bounded cache for revoked JTIs, fail-closed (503) default on Redis outage with opt-in fail-open (`AUTH_REVOCATION_FAIL_OPEN=true`), and configurable negative cache TTL (`AUTH_REVOCATION_CACHE_TTL_MS`, default 0 = off).
- Architecture coherent: `RevokedJtiCache` provides bounded in-memory lookup (`maxEntries: 10_000`, TTL: `ACCESS_TOKEN_TTL * 1000`). `AuthService.logout` immediately marks revoked locally and writes to Redis. `AuthService.isRevoked` checks local cache before Redis.
- Boundaries reasonable: Changes remain isolated to `src/auth/revocation/` and `src/auth/auth.service.ts`; no disruption to `AccessTokenAuthenticator` or JWT signature validation.
- Failure modes considered:
  - Redis blip with fail-closed: throws `ServiceUnavailableException` (503 Service Unavailable), preventing revoked sessions from accessing protected resources during an outage.
  - Redis blip with fail-open (`AUTH_REVOCATION_FAIL_OPEN=true`): allows cryptographically valid RS256 JWTs with warning log; exposure window bounded by `ACCESS_TOKEN_TTL`.
  - Cache size exhaustion: oldest entry eviction prevents memory leaks.
- Data consistency correct: Redis remains the cross-VM ground truth. Default negative TTL of 0 ensures cross-VM logouts take effect immediately.
- Scalability adequate: Eliminates repeated Redis `GET` calls on bursty traffic from the same JWTs; memory overhead < 2MB for 10,000 UUID strings.
- Security considered: Security-first default (fail-closed). Fail-open is explicit opt-in only. JWT signature and expiration checks still apply.
- Observability defined: Warning logs emitted on Redis lookup failure and fail-open degradation.
- Operational model defined: Configurable via `AUTH_REVOCATION_FAIL_OPEN` and `AUTH_REVOCATION_CACHE_TTL_MS`.

## Recommendation

PASS. The design provides strong fault isolation and performance enhancement without compromising default security guarantees. A human owner sets Status to `accepted` to approve implementation.
