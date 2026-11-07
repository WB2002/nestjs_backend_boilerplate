# ALB + multi-VM deployment notes

Operational checklist for running **multiple targets** behind an **Application Load Balancer** with this NestJS Fastify app.

## Topology

```text
Internet → ALB (HTTPS) → Target group (N × tasks on :PORT) → Fastify
                              ↘
                           ElastiCache Redis (rate limit, cache, GraphQL, feature flags, JTI)
```

## ALB target group

| Setting                            | Recommendation                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| **Target group health check path** | `/health/ready` (readiness)                                                              |
| **Liveness probe path**            | `/health/live` (I/O-free container liveness)                                             |
| **Health check interval**          | 30s (adjust per SLO)                                                                     |
| **Healthy threshold**              | 2                                                                                        |
| **Unhealthy threshold**            | 2–3                                                                                      |
| **Success codes**                  | 200                                                                                      |
| **Stickiness**                     | **Off** for JWT APIs (stateless); enable only if you intentionally need session affinity |
| **Deregistration delay**           | ≥ **`SHUTDOWN_DRAIN_MS`** (default 10000 ms in `.env.example`)                           |

Health routes skip rate limit, request deadline, inbound bulkhead, and country access (`HealthController` decorators) so probes are not **429** during deploys.

### Health probe endpoints

- **`GET /health/live` (Liveness)**:
  Zero I/O, instantaneous probe designed for container orchestrator liveness checks (ECS/Kubernetes). Returns `{ status: 'ok' }` immediately without hitting MongoDB, Redis, or Postgres. Returns `503 Service Unavailable` if the node has begun graceful shutdown (`ShutdownState.isShuttingDown`).
- **`GET /health/ready` (Readiness / ALB Target Group)**:
  Evaluates dependency connectivity (Mongo ping, Memory heap, Storage, Redis, Postgres via a dedicated 1-connection lazy `pg.Pool`). Results are single-flighted and cached for `HEALTH_CHECK_CACHE_TTL_MS` (default 2000 ms) to prevent thundering herd under frequent multi-AZ health checks. As soon as graceful shutdown begins, `/health/ready` immediately and synchronously bypasses cache and reports 503 so the ALB deregisters the target.
- **`GET /health`**:
  Aggregated full health report, cached similarly to `/health/ready`.

## Keep-alive and ALB idle timeout

AWS ALB defaults to a **60-second idle connection timeout**. If the backend server closes an idle TCP connection at the same millisecond the ALB reuses it for an incoming request, the client receives an intermittent **HTTP 502 Bad Gateway**.

To avoid this race condition:

- Node/Fastify keep-alive timeout must **exceed** the ALB idle timeout.
- The app defaults `HTTP_KEEP_ALIVE_TIMEOUT_MS=65000` (65 seconds).
- `headersTimeout` is automatically set to `keepAliveTimeoutMs + 1000` (66,000 ms), complying with Node.js HTTP server requirements.
- If you change the ALB idle timeout (e.g. to 120s), set `HTTP_KEEP_ALIVE_TIMEOUT_MS` accordingly (e.g. `125000`).

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
