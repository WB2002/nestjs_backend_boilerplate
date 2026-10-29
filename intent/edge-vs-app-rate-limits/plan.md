# Edge vs App Rate Limits & ALB Multi-VM Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish **operations documentation** so engineers can deploy **ALB + ≥2 VMs + Redis** without reading source: where to enforce limits (edge vs app), HTTP status semantics (**429** vs **503**), and ALB/ECS wiring (`TRUST_PROXY`, health, drain).

**Architecture:** Two new markdown guides under **`docs/operations/`**, linked from **`docs/features/features.md`**. Content reflects **already-shipped** resilience work (Tasks 1–5, 7; Task 0 after its plan lands). **No application code changes** except optional status-table tweaks in `features.md`.

**Tech Stack:** Markdown only; references existing env vars and modules (`RateLimitGuard`, `OverloadModule`, `ComplexityPlugin`, `HttpClient`).

## Global Constraints

- **Runtime:** N/A (docs task).
- **Scope OUT:** Terraform/CDK for WAF/ALB; CI/CD pipelines; changing rate-limit demo quotas in `app.module.ts`.
- **Prerequisites:** Tasks **1, 2, 5** shipped; **Task 0** recommended so Redis rate-limit section matches production defaults; **Task 3–4, 7** referenced for HttpClient/deadline/adaptive sections.
- **Branch workflow:** **`feat/resilience-task-6-ops-docs`**, merge to **`master`** with `--no-ff`.

---

## File map

| File                                         | Responsibility                                                     |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `docs/operations/edge-vs-app-rate-limits.md` | WAF/ALB vs app quotas; 429 vs 503 table                            |
| `docs/operations/alb-multi-vm.md`            | ALB target group, health, drain, stickiness                        |
| `docs/features/features.md`                  | Links + status row updates (backpressure, load shedding, deadline) |
| `.superpowers/sdd/progress.md`               | Mark Task 6 complete                                               |

---

### Task 1: Create `edge-vs-app-rate-limits.md`

**Files:**

- Create: `docs/operations/edge-vs-app-rate-limits.md`

- [ ] **Step 1: Create directory and file with full content**

````markdown
# Edge vs application rate limits

This boilerplate runs **NestJS on Fastify** behind an **AWS Application Load Balancer (ALB)** with **≥2 EC2/ECS tasks**. Use **edge** controls for volumetric abuse and **application** controls for product quotas and tenant fairness.

## Default stack (no sidecar)

```text
Client → [optional WAF] → ALB → Fastify :3000 (this app)
```
````

We **do not** deploy Nginx or Envoy sidecars by default. Inbound protection lives in Fastify plugins and Nest middleware/guards.

## Layer responsibilities

| Layer                         | Purpose                                          | Examples in this repo                                                              | Typical HTTP code                                 |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| **WAF / ALB**                 | Volumetric abuse, geo blocks, IP reputation, TLS | AWS WAF rate-based rules; ALB connection idle timeout                              | Connection drop / WAF block (403)                 |
| **`RateLimitGuard`**          | Product / tenant quotas, authenticated fairness  | `@RateLimit()`, `RateLimitIdentifier.UserId`, Redis backend (`RATE_LIMIT_STORAGE`) | **429** + `Retry-After`                           |
| **`@fastify/under-pressure`** | Process health (event loop / heap)               | `UNDER_PRESSURE_*` in `main.ts`                                                    | **503** + `Retry-After`                           |
| **Inbound bulkhead**          | Per-VM in-flight cap (fail-fast)                 | `INBOUND_MAX_IN_FLIGHT`, `InboundBulkheadMiddleware`                               | **503** + `Retry-After`                           |
| **GraphQL concurrency**       | Per-subject in-flight GraphQL (cluster Redis)    | `ComplexityPlugin`, `GQL_MAX_CONCURRENCY`                                          | **503** + `Retry-After` (overload)                |
| **Outbound HttpClient**       | Protect downstreams from this service            | `.addConcurrencyLimit()`, optional `mode: 'adaptive'`                              | Client-side queue or `AdaptiveLimitExceededError` |

## Do not duplicate product rules at the edge

- **WAF** should stop obvious floods (e.g. >N requests/5 min per IP) and bot signatures.
- **Do not** mirror per-user or per-API `@RateLimit` rules in WAF — they belong in **`RateLimitGuard`** with **Redis** so all tasks share counters.
- **Enterprise:** Prefer **`RateLimitIdentifier.UserId`** (and cost decorators) for authenticated APIs; use **IP / guest / device** for anonymous surfaces.

## 429 vs 503 decision table

| Symptom                                             | Mechanism                 | Code    | Client action                                |
| --------------------------------------------------- | ------------------------- | ------- | -------------------------------------------- |
| Quota exceeded (policy)                             | `RateLimitGuard`          | **429** | Back off per `Retry-After`; reduce call rate |
| Server overloaded (health)                          | `@fastify/under-pressure` | **503** | Retry with backoff                           |
| Too many concurrent inbound HTTP requests (this VM) | Inbound bulkhead          | **503** | Retry; ALB should route to other tasks       |
| Too many concurrent GraphQL ops (cluster)           | GraphQL Redis concurrency | **503** | Retry; not a “quota” violation               |
| Dependency unhealthy                                | Terminus `/health`        | **503** | ALB marks target unhealthy                   |

Health probes **`/health`** and **`/health/ready`** are exempt from rate limit, deadline, bulkhead, and country access so ALB checks stay **200/503** for readiness only.

## Multi-VM math (application layer)

| Control                   | Scope                      | Cluster-wide cap                                                                    |
| ------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `RateLimitGuard` + Redis  | Shared keys (`rl:` prefix) | **Yes** — configure `RATE_LIMIT_STORAGE=redis`                                      |
| Inbound bulkhead          | Per process                | **No** — approximate cluster cap ≈ **`N × INBOUND_MAX_IN_FLIGHT`**                  |
| HttpClient `clusterAware` | Per process                | **Yes** — set `HTTP_CLIENT_INSTANCE_COUNT` to max task count; sum ≈ `maxConcurrent` |
| GraphQL concurrency       | Redis per subject          | **Yes** — shared Redis                                                              |
| Cache (when enabled)      | Redis                      | **Yes** — `CACHE_STORAGE=redis`                                                     |

## Related env vars

| Variable                   | Role                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `TRUST_PROXY`              | `true` behind ALB so `req.ip` is the client IP for IP rate limits |
| `RATE_LIMIT_STORAGE`       | `memory` (dev) / `redis` (prod default when unset in production)  |
| `OVERLOAD_RETRY_AFTER_SEC` | Seconds on 503 overload responses                                 |
| `GQL_MAX_CONCURRENCY`      | Per-subject GraphQL concurrency across tasks                      |

## See also

- [ALB multi-VM deployment](./alb-multi-vm.md)
- [Features status — rate limiting](../features/features.md)

````

- [ ] **Step 2: Commit**

```bash
git add docs/operations/edge-vs-app-rate-limits.md
git commit -m "docs(ops): edge vs app rate limits guide (Task 6)"
````

---

### Task 2: Create `alb-multi-vm.md`

**Files:**

- Create: `docs/operations/alb-multi-vm.md`

- [ ] **Step 1: Write file**

````markdown
# ALB + multi-VM deployment notes

Operational checklist for running **multiple targets** behind an **Application Load Balancer** with this NestJS Fastify app.

## Topology

```text
Internet → ALB (HTTPS) → Target group (N × tasks on :PORT) → Fastify
                              ↘
                           ElastiCache Redis (rate limit, cache, GraphQL, feature flags, JTI)
```
````

## ALB target group

| Setting                   | Recommendation                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| **Health check path**     | `/health/ready` (readiness) or `/health` (liveness — stricter)                           |
| **Health check interval** | 30s (adjust per SLO)                                                                     |
| **Healthy threshold**     | 2                                                                                        |
| **Unhealthy threshold**   | 2–3                                                                                      |
| **Success codes**         | 200                                                                                      |
| **Stickiness**            | **Off** for JWT APIs (stateless); enable only if you intentionally need session affinity |
| **Deregistration delay**  | ≥ **`SHUTDOWN_DRAIN_MS`** (default 10000 ms in `.env.example`)                           |

Health routes skip rate limit, request deadline, inbound bulkhead, and country access (`HealthController` decorators) so probes are not **429** during deploys.

## Trust proxy and client IP

Set in production:

```bash
TRUST_PROXY=true
```

Fastify then uses the ALB-forwarded client IP for **`req.ip`**, which powers:

- IP rate limiting (`RateLimitIdentifier.Ip`)
- Country access
- Captcha / abuse signals

Do **not** parse `X-Forwarded-For` manually in application code.

Local development: leave `TRUST_PROXY=false` to prevent spoofing.

## Graceful shutdown

| Env var             | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `SHUTDOWN_DRAIN_MS` | Stop accepting new work; wait for in-flight HTTP to finish before close |
| `SHUTDOWN_FORCE_MS` | Upper bound before forced exit                                          |

Align **ALB target deregistration delay** ≥ **`SHUTDOWN_DRAIN_MS`** so the load balancer stops sending traffic before the process exits.

Smoke script: `pnpm run smoke:shutdown` (`scripts/smoke-graceful-shutdown.sh`).

## Redis

Single logical Redis (or cluster) shared by all tasks for:

- Rate limits (`RATE_LIMIT_STORAGE=redis`)
- Cache (`CACHE_STORAGE=redis`)
- GraphQL concurrency keys
- Auth JTI revocation (`REDIS_HOST` / `REDIS_PORT` — required at boot)

Tasks use **`lazyConnect`** for rate-limit/cache Redis clients; connect failures are logged but do not block boot.

## Scaling checklist

1. **Redis** reachable from all tasks in the VPC.
2. **`TRUST_PROXY=true`** on every task.
3. **`HTTP_CLIENT_INSTANCE_COUNT`** set to **maximum** expected task count when using `clusterAware` HttpClient limits.
4. **`INBOUND_MAX_IN_FLIGHT`** tuned per task; remember cluster approximate cap **`N × maxInFlight`**.
5. **No stickiness** unless required — JWT auth is stateless.
6. **WAF** optional in front of ALB for volumetric rules (see [edge vs app rate limits](./edge-vs-app-rate-limits.md)).

## Out of scope for this repo

- Terraform/CDK modules for ALB, WAF, ECS — bring your own IaC.
- Nginx/Envoy sidecars — not part of the default enterprise deployment.

````

- [ ] **Step 2: Commit**

```bash
git add docs/operations/alb-multi-vm.md
git commit -m "docs(ops): ALB multi-VM deployment guide (Task 6)"
````

---

### Task 3: Link from `features.md` and refresh status rows

**Files:**

- Modify: `docs/features/features.md`

- [ ] **Step 1: Add Operations section** (near top or after feature table — match doc style)

```markdown
## Operations (multi-VM)

- [Edge vs app rate limits](./operations/edge-vs-app-rate-limits.md)
- [ALB + multi-VM deployment](./operations/alb-multi-vm.md)
```

- [ ] **Step 2: Update implementation status rows** (Resilience table)

Replace or extend these rows to reflect shipped work:

```markdown
| Backpressure | **Partial** | Under-pressure + inbound bulkhead + GraphQL Redis concurrency + HttpClient limits — see [edge vs app rate limits](./operations/edge-vs-app-rate-limits.md); API priority queues still missing |
| Load shedding + `Retry-After` | **Partial** | **429** rate limit; **503** overload (pressure, bulkhead, GraphQL concurrency) — decision table in ops doc |
| Deadline propagation | **Done** | Inbound ALS; HttpClient inherits signal + caps timeouts by `remainingMs()` |
```

- [ ] **Step 3: Commit**

```bash
git add docs/features/features.md
git commit -m "docs(features): link ops guides and refresh resilience status (Task 6)"
```

---

### Task 4: Progress ledger and superplan cross-link

**Files:**

- Modify: `.superpowers/sdd/progress.md`
- Modify: `intent/multi-vm-resilience-superplan/plan.md` (optional one-line under Task 6: child plan path)

- [ ] **Step 1: Update progress**

```markdown
Task 6: complete (edge vs app rate limits + ALB multi-VM ops docs)
```

- [ ] **Step 2: Commit**

```bash
git add .superpowers/sdd/progress.md intent/multi-vm-resilience-superplan/plan.md
git commit -m "docs: mark Task 6 complete in SDD progress (Task 6)"
```

---

## Self-review

| Superplan Task 6 requirement                    | Plan task      |
| ----------------------------------------------- | -------------- |
| `edge-vs-app-rate-limits.md`                    | Task 1         |
| WAF/ALB vs RateLimitGuard                       | Task 1 content |
| 429 vs 503 table                                | Task 1 content |
| Multi-VM math (bulkhead, clusterAware)          | Task 1 content |
| `alb-multi-vm.md`                               | Task 2         |
| TRUST_PROXY, `/health/ready`, SHUTDOWN_DRAIN_MS | Task 2 content |
| No Nginx/Envoy default                          | Task 1 + 2     |
| Update features.md                              | Task 3         |

**Placeholder scan:** Full markdown provided in steps; no TBD.

**Type consistency:** N/A (docs).

---

## Execution handoff

**Plan saved to** `intent/edge-vs-app-rate-limits/plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Task 1 → Task 2 → Task 3 → Task 4 as separate subagents.
2. **Inline Execution** — single session; all files are documentation-only (fast).

**Which approach?**
