# ALB + multi-VM deployment notes

Operational checklist for running **multiple targets** behind an **Application Load Balancer** with this NestJS Fastify app.

## Topology

```text
Internet → ALB (HTTPS) → Target group (N × tasks on :PORT) → Fastify
                              ↘
                           ElastiCache Redis (rate limit, cache, GraphQL, feature flags, JTI)
```

## ALB target group

| Setting | Recommendation |
| ------- | ---------------- |
| **Health check path** | `/health/ready` (readiness) or `/health` (liveness — stricter) |
| **Health check interval** | 30s (adjust per SLO) |
| **Healthy threshold** | 2 |
| **Unhealthy threshold** | 2–3 |
| **Success codes** | 200 |
| **Stickiness** | **Off** for JWT APIs (stateless); enable only if you intentionally need session affinity |
| **Deregistration delay** | ≥ **`SHUTDOWN_DRAIN_MS`** (default 10000 ms in `.env.example`) |

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

| Env var | Purpose |
| ------- | ------- |
| `SHUTDOWN_DRAIN_MS` | Stop accepting new work; wait for in-flight HTTP to finish before close |
| `SHUTDOWN_FORCE_MS` | Upper bound before forced exit |

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
