# Performance Review Report: NestJS Boilerplate (All Features)

Source: `docs/features/features.md` · Targets: `docs/nfr.md`  
Verdict: **AT RISK** (SLO Breach Likely)

Reviewed by: `performance-reviewer` subagent (Composer 2.5). Read-only; no application code changes.

## 1. SLO & Resource Budget Summary

- **Applicable Latency / Throughput / Memory Targets (`docs/nfr.md`):**
  - Multi-instance deployment behind ALB; overload shedding, bulkheads, and deadline propagation documented in feature/ops docs (no numeric p50/p95/p99).
  - HttpClient adaptive concurrency and bulkheads per `docs/features/http_client.feature.md`.
  - Log PII redaction; job/session retention per module env.
- **Primary Bottlenecks Identified:**
  - **Auth (JWT):** RS256 verify → Redis revocation `GET` → Mongo `findById` (and possible `save`) on every protected REST/GraphQL request.
  - **GraphQL admission gap:** HTTP inbound bulkhead and `RateLimitGuard` do not treat `graphql` execution context like REST (`JwtAuthGuard` / `CountryAccessGuard` do).
  - **Rate limiting:** Demo default 10 req/min per IP; memory backend O(n) expiry scan per `consume`.
  - **Uploads:** Full in-memory buffers through validation and ClamAV.
  - **WebSockets:** Redis SMEMBERS + per-member EXISTS on every connection register; unbounded in-memory message counters without Redis adapter.
  - **Ops proof gap:** No k6/Artillery suite to validate overload behavior at scale.

**Strengths (not failures):** Feature-flag request-path eval is in-memory; overload toolkit (bulkhead, load leveling, priority shed, EMF 503 reasons); HttpClient adaptive limits/coalescing/CB; cache SWR/single-flight/Redis loader locks; health probe coalescing via `HealthSnapshot`; country access is in-process MaxMind after snapshot load; Argon2 behind `PasswordHashBulkhead`; conformance harness blocked when `NODE_ENV=production`.

## 2. Findings by Severity

### PERF-001 (High)

- **Category:** Excessive I/O
- **Location:** `src/auth/access-token-authenticator.service.ts:42-49`, `src/auth/auth.service.ts:168-178`
- **Failure Mechanism Under Load:** After RS256 verify, every protected request runs `isRevoked` (Redis `GET`) then `resolveAuthoritativeRoleForUserId` (Mongo `findById`). Traffic scales Redis QPS and Mongo pool use linearly with authenticated RPS.
- **Estimated SLO / Resource Impact:** +5–30 ms p99 per hop (network-dependent); Mongo/Redis saturation at 500+ authenticated RPS without caching or claim embedding.
- **Concrete Remediation Specification (for `performance-implementer`):** Short-TTL cache for revocation + role; embed `role` (and optional session version) in JWT with controlled refresh; skip Mongo when claims are fresh; document expected auth throughput in `docs/features/auth.feature.md`.

### PERF-002 (High)

- **Category:** Algorithmic / CPU
- **Location:** `src/core/overload/guards/inbound-priority-bulkhead.guard.ts:36-38`
- **Failure Mechanism Under Load:** Guard returns immediately when `context.getType() !== 'http'`. GraphQL resolver execution is `graphql`, so inbound bulkhead, load-level queue, and API priority shedding do not apply. REST can be shed while GraphQL consumes CPU/Mongo/event-loop without the same caps.
- **Estimated SLO / Resource Impact:** GraphQL as alternate overload vector; cluster 503 shedding on REST does not protect GraphQL under mixed traffic.
- **Concrete Remediation Specification (for `performance-implementer`):** Shared admission for `graphql` (extend guard or shared semaphore); align with `ComplexityPlugin` Redis concurrency; document GraphQL budgets in feature doc.

### PERF-003 (High)

- **Category:** Excessive I/O / Misconfiguration
- **Location:** `src/core/rate-limiter/guards/rate-limit.guard.ts:69-76`, `src/core/rate-limiter/http/get-http-request.ts:4-6`, `src/app.module.ts:147-156`
- **Failure Mechanism Under Load:** `RateLimitGuard` uses `switchToHttp()` only (unlike `CountryAccessGuard` / `JwtAuthGuard` with `GqlExecutionContext`). GraphQL may miss app-level rate limits. Default `global-ip` policy is **10 requests / 60s** — unusable behind shared NAT/ALB without retuning.
- **Estimated SLO / Resource Impact:** False 429 storms for corporate egress; uneven REST vs GraphQL protection.
- **Concrete Remediation Specification (for `performance-implementer`):** Gql-aware request resolution in guard/trackers; environment-specific rate-limit profiles; integration test proving GraphQL consumes limits.

### PERF-004 (Medium)

- **Category:** Algorithmic / CPU
- **Location:** `src/core/rate-limiter/backends/memory.backend.ts:34-35`, `73-78`
- **Failure Mechanism Under Load:** Every `consume` scans all metadata keys in `evictExpired`. Up to `MEMORY_BACKEND_MAX_KEYS` (50,000) keys → O(n) per request on dev/staging without Redis.
- **Estimated SLO / Resource Impact:** Elevated event-loop delay at high client cardinality; p99 tail on rate-limited paths.
- **Concrete Remediation Specification (for `performance-implementer`):** Lazy expiry on touch + periodic sweeper; require Redis (`RATE_LIMIT_STORAGE=redis`) for multi-instance/load-test environments.

### PERF-005 (Medium)

- **Category:** Excessive I/O
- **Location:** `src/auth/auth.service.ts:76-96`, `134-134`, `207-217`
- **Failure Mechanism Under Load:** Login/session creation does sequential Mongo reads/writes (`findOne`, `save`, `findById`). `ensureAdminRoleIfAllowlisted` can **`user.save()` on the JWT hot path** until role is persisted for allowlisted emails.
- **Estimated SLO / Resource Impact:** Login p99 bound by Argon2 (intentional) plus 2–3 DB round trips; unexpected Mongo writes on authenticated traffic for newly allowlisted admins.
- **Concrete Remediation Specification (for `performance-implementer`):** Collapse session+user fetch; promote admin role only at login/refresh, not per request; stricter `/auth/*` rate limits.

### PERF-006 (Medium)

- **Category:** Memory / Excessive I/O
- **Location:** `src/common/uploads/validate-upload-files.ts:50-74`, `src/common/uploads/scanners/clamav-file-scanner.ts:34-39`
- **Failure Mechanism Under Load:** Multipart files held entirely in `buffer` until magic-byte check and ClamAV instream complete. Memory ∝ concurrent uploads × `UPLOAD_MAX_FILE_SIZE`.
- **Estimated SLO / Resource Impact:** Heap pressure and GC pauses; ClamAV TCP hold per upload blocks completion.
- **Concrete Remediation Specification (for `performance-implementer`):** Stream-to-temp with size caps; bounded concurrent scan workers; `@ApiPriority` shedding for upload routes.

### PERF-007 (Medium)

- **Category:** Excessive I/O
- **Location:** `src/core/feature-flag/feature-flag.manager.ts:38-41`
- **Failure Mechanism Under Load:** Admin `GET /feature-flags` calls `loadAllFlags` with no pagination. Request-path `isEnabled` is in-memory (good).
- **Estimated SLO / Resource Impact:** Slow admin UI and read amplification as flag count grows; not on hot eval path.
- **Concrete Remediation Specification (for `performance-implementer`):** Cursor pagination for admin list; optional cached snapshot for dashboards.

### PERF-008 (Medium)

- **Category:** Excessive I/O
- **Location:** `src/core/websocket/rate-limit/ws-connection-limiter.service.ts:27-52`, `55-79`
- **Failure Mechanism Under Load:** Every `registerConnection` (Redis mode) runs `SMEMBERS` plus pipeline `EXISTS` for each member, then `SADD`/`SCARD`. Reconnect storms amplify Redis RTT and CPU linearly with stale socket entries.
- **Estimated SLO / Resource Impact:** Connection handshake p99 spikes under mobile flaky networks; Redis CPU climbs with connection churn.
- **Concrete Remediation Specification (for `performance-implementer`):** TTL-only alive keys without full-set scan; cap prune batch size; defer prune to background timer.

### PERF-009 (Low)

- **Category:** Memory Leak
- **Location:** `src/core/websocket/guards/ws-message-rate-limiter.guard.ts:18-21`, `57-69`
- **Failure Mechanism Under Load:** In-memory `localCounts` Map retains per-`userId` entries with no sweeper or disconnect cleanup when `redisAdapterEnabled` is false. Long-lived processes with many unique users leak entries until the same user sends again after window reset.
- **Estimated SLO / Resource Impact:** Slow RSS growth over days on single-VM WS deployments without Redis adapter.
- **Concrete Remediation Specification (for `performance-implementer`):** Periodic TTL sweep; delete on disconnect; require Redis adapter for production multi-VM WS.

### PERF-010 (Low)

- **Category:** Algorithmic / CPU
- **Location:** `src/common/sanitization/utils/ssrf.utils.ts:37-55`; global `SanitizationPipe`
- **Failure Mechanism Under Load:** `@SafeUrl` triggers `dns.lookup(..., { all: true })` per URL field. Large DTOs with many URLs serialize DNS work on the request path.
- **Estimated SLO / Resource Impact:** +100–500 ms p99 on rare bulk URL payloads.
- **Concrete Remediation Specification (for `performance-implementer`):** Short-TTL DNS result cache; cap array sizes before sanitization walk; document `@SafeUrl` cost in conventions.

### PERF-011 (Low)

- **Category:** Algorithmic / CPU
- **Location:** `src/core/feature-flag/feature-flag.service.ts:54-77`, `197-199`
- **Failure Mechanism Under Load:** `isEnabled` calls `emitFeatureFlagMetrics` on every evaluation when `FEATURE_FLAG_METRICS` is not `false` (default on). Health checks also emit via `getHealthStatus`.
- **Estimated SLO / Resource Impact:** Minor CPU/EMF overhead when `isEnabled` is called many times per request; measurable only in tight flag-check loops.
- **Concrete Remediation Specification (for `performance-implementer`):** Default metrics off in dev; sample or aggregate evaluations; cache health metrics emission.

### PERF-012 (Low)

- **Category:** Missing budgets
- **Location:** `docs/features/features.md:80`, `docs/nfr.md`
- **Failure Mechanism Under Load:** No k6/Artillery/ZAP configs to prove bulkhead, rate-limit, GraphQL concurrency, or auth throughput at 10× traffic before deploy. `docs/nfr.md` has no numeric latency SLOs to PASS/FAIL against.
- **Estimated SLO / Resource Impact:** Overload controls are structurally sound but unproven; regressions ship without detection.
- **Concrete Remediation Specification (for `performance-implementer`):** Nightly smoke load suite (health, auth login, GraphQL query, 429 rate-limit, 503 bulkhead); add numeric SLO placeholders to `docs/nfr.md`.

## 3. Unbounded Work & Missing Budgets

- **GraphQL:** Depth limit (10) and complexity budget exist; no inbound HTTP bulkhead; app rate limits may not bind (`PERF-002`, `PERF-003`). Redis concurrency acquired before complexity validation in `ComplexityPlugin.requestDidStart` — cheap-to-parse but expensive queries still consume slots until `didResolveOperation`.
- **Auth:** Unbounded per-request Redis+Mongo on JWT path (`PERF-001`); no caching layer on hot reads despite `CacheService` core being ready (Partial status — no business module opt-in).
- **Rate limit memory backend:** 50k key cap with LRU eviction but O(n) scan each request (`PERF-004`).
- **Uploads:** Count/size/total caps via env; no concurrent-upload worker cap — memory scales with parallelism (`PERF-006`).
- **Feature flags admin:** Unpaginated `list()` (`PERF-007`).
- **WebSockets:** Connection and message limits exist; Redis prune fanout unbounded per member set (`PERF-008`); in-memory message counters unbounded across users (`PERF-009`).
- **Background jobs:** `SKIP LOCKED` claim pattern and bounded `leaseReclaimBatchSize`; sequential `wakeJobRow` in reclaim tick — bounded by batch, not unbounded.
- **Health:** `HealthSnapshot` TTL coalesces probes; uncached tick still runs Mongo ping, heap, disk (`/`), Redis ping, Postgres `SELECT 1`, feature-flag health.
- **Conformance harness:** `loaderDelayMs` up to 10s (`ConformanceCacheRequestDto`); production boot fails if enabled (`validate-env`); staging abuse still possible with token — not a prod risk.
- **Logging/tracing:** `LoggingInterceptor` skips non-HTTP (GraphQL resolvers rely on OTel HTTP instrumentation on the POST). `RequestDeadlineInterceptor` uses `switchToHttp()` for route timeout headers — middleware ALS still applies to `/graphql` HTTP entry.
- **Cache (Partial):** `inFlight` Map in `CacheService` is bounded per-key and cleared in `finally`; business routes (auth, categories, flags) do not use `getOrSet` on hot reads.
- **Load testing:** **Missing** — no automated proof of NFR-adjacent overload behavior (`PERF-012`).
- **Streaming responses:** Partial — no demonstrated large export/stream endpoints; risk deferred until implemented.

---

### Changelog vs prior in-session draft

| Item              | Change                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| PERF-003 severity | Raised to **High** (GraphQL rate-limit gap + unusable default 10/min)         |
| PERF-010 (old)    | Was "Info" for missing load tests → renumbered to **PERF-012** as **Low**     |
| New               | **PERF-008** WebSocket Redis prune fanout; **PERF-009** WS in-memory map leak |
| Format            | Aligned to `.cursor/agents/performance-reviewer.md` sections 1–3              |
