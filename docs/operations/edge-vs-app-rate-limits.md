# Edge vs application rate limits

This boilerplate runs **NestJS on Fastify** behind an **AWS Application Load Balancer (ALB)** with **≥2 EC2/ECS tasks**. Use **edge** controls for volumetric abuse and **application** controls for product quotas and tenant fairness.

## Default stack (no sidecar)

```text
Client → [optional WAF] → ALB → Fastify :3000 (this app)
```

We **do not** deploy Nginx or Envoy sidecars by default. Inbound protection lives in Fastify plugins and Nest middleware/guards.

## Layer responsibilities

| Layer                         | Purpose                                              | Examples in this repo                                                              | Typical HTTP code                                   |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| **WAF / ALB**                 | Volumetric abuse, geo blocks, IP reputation, TLS     | AWS WAF rate-based rules; ALB connection idle timeout                              | Connection drop / WAF block (403)                   |
| **`RateLimitGuard`**          | Product / tenant quotas, authenticated fairness      | `@RateLimit()`, `RateLimitIdentifier.UserId`, Redis backend (`RATE_LIMIT_STORAGE`) | **429** + `Retry-After`                             |
| **`@fastify/under-pressure`** | Process health (event loop / heap)                   | `UNDER_PRESSURE_*` in `main.ts`                                                    | **503** + `Retry-After`                             |
| **Inbound bulkhead**          | Per-VM in-flight cap (fail-fast)                     | `INBOUND_MAX_IN_FLIGHT`, `InboundPriorityBulkheadGuard`                            | **503** + `Retry-After`                             |
| **Inbound load leveling**     | Optional bounded wait queue before hard cap (per VM) | `INBOUND_LOAD_LEVELING_*`, same guard                                              | **503** + `Retry-After` (queue full / wait timeout) |
| **API priority shed**         | Shed lower-priority routes before hard cap           | `@ApiPriority()`, `INBOUND_PRIORITY_SHEDDING_*`                                    | **503** + `Retry-After`                             |
| **GraphQL concurrency**       | Per-subject in-flight GraphQL (cluster Redis)        | `ComplexityPlugin`, `GQL_MAX_CONCURRENCY`                                          | **503** + `Retry-After` (overload)                  |
| **Outbound HttpClient**       | Protect downstreams from this service                | `.addConcurrencyLimit()`, optional `mode: 'adaptive'`                              | Client-side queue or `AdaptiveLimitExceededError`   |

## Do not duplicate product rules at the edge

- **WAF** should stop obvious floods (e.g. >N requests/5 min per IP) and bot signatures.
- **Do not** mirror per-user or per-API `@RateLimit` rules in WAF — they belong in **`RateLimitGuard`** with **Redis** so all tasks share counters.
- **Enterprise:** Prefer **`RateLimitIdentifier.UserId`** (and cost decorators) for authenticated APIs; use **IP / guest / device** for anonymous surfaces.

## 429 vs 503 decision table

| Symptom                                                      | Mechanism                                                    | Code    | Client action                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------- | ---------------------------------------------------------- |
| Quota exceeded (policy)                                      | `RateLimitGuard`                                             | **429** | Back off per `Retry-After`; reduce call rate               |
| Server overloaded (health)                                   | `@fastify/under-pressure`                                    | **503** | Retry with backoff                                         |
| Too many concurrent inbound HTTP requests (this VM)          | Inbound bulkhead (hard cap)                                  | **503** | Retry; ALB should route to other tasks                     |
| At bulkhead cap, optional short wait queue full or timed out | Inbound load leveling (`INBOUND_LOAD_LEVELING_ENABLED=true`) | **503** | Retry; tune `INBOUND_LOAD_LEVEL_MAX_QUEUE` / `MAX_WAIT_MS` |
| Low-priority API shed under load (before hard cap)           | API priority shedding                                        | **503** | Retry; defer batch/export traffic                          |
| Too many concurrent GraphQL ops (cluster)                    | GraphQL Redis concurrency                                    | **503** | Retry; not a “quota” violation                             |
| Dependency unhealthy                                         | Terminus `/health`                                           | **503** | ALB marks target unhealthy                                 |

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

- [CloudWatch alarms for 503 overload metrics](./cloudwatch-overload-alerts.md)
- [ALB multi-VM deployment](./alb-multi-vm.md)
- [Features status — rate limiting](../features/features.md)
