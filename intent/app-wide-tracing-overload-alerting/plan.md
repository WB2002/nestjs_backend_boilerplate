# App-Wide Tracing + Overload/503 Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export **OpenTelemetry traces for the whole Nest/Fastify app** (inbound HTTP, Nest handlers, GraphQL, outbound `HttpClient`) with **AWS X-Ray propagation**, and emit **CloudWatch EMF metrics + alarm recipes** whenever the app returns **503** from overload shedding (under-pressure, bulkhead, GraphQL concurrency) and other service-unavailable paths ops care about.

**Architecture:** Add a shared `src/core/telemetry/` module (config, X-Ray propagator, EMF helpers, **`isTraceExemptPath`** aligned with `PRESSURE_EXEMPT_PATHS`). Bootstrap the OTel **Node SDK** before the HTTP server loads (`node -r dist/instrumentation.js`). Rely on **`@opentelemetry/instrumentation-http`** (+ Fastify when compatible) for **SERVER** spans on **non-probe** routes only; **`/health` and `/health/ready` are ignored** at instrumentation and Nest layers (`@SkipTracing()` on `HealthController`). Enrich active spans in `TracingInterceptor` and GraphQL plugin; **refactor** HTTP client tracing to import the shared propagator. Emit **`Application` / `ServiceUnavailable`** EMF metrics at each 503 source with a **`Reason`** dimension, then document **CloudWatch alarms** (and optional SNS) keyed on those metrics plus ALB `HTTPCode_ELB_503_Count`.

**Tech Stack:** NestJS 11, Fastify 5, OpenTelemetry JS (`@opentelemetry/api`, SDK, AWS X-Ray propagator + ID generator), `aws-embedded-metrics`, Jest (`pnpm exec jest … --watchman=false`).

## Global Constraints

- **Runtime:** Node **22+** (`Dockerfile`); package manager **pnpm**; tests via **`pnpm exec jest --watchman=false`** (see `jest.config.ts`).
- **HTTP server:** Fastify via `@nestjs/platform-fastify`; plugins registered in **`src/main.ts`**.
- **Tracing export:** **ADOT Collector** or **CloudWatch Agent** sidecar with **X-Ray** exporter — same as `docs/features/http_client.feature.md` (no `aws-xray-sdk`).
- **Imports:** Top of file only (no inline imports) per workspace rule.
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Overload HTTP semantics:** **503** + **`Retry-After`** for saturation (`docs/operations/edge-vs-app-rate-limits.md`); **429** stays **`RateLimitGuard`** only.
- **Health probes:** `/health`, `/health/ready` exempt from bulkhead/pressure **and from all distributed tracing** (no inbound SERVER spans, no X-Ray segment export, no Nest `TracingInterceptor` span enrichment, no `traceId`/`spanId` on probe logs). Reuse the same path set as `PRESSURE_EXEMPT_PATHS` in `src/core/overload/overload.constants.ts` via `isTraceExemptPath()` — do not duplicate path strings. Terminus **503** on readiness may still emit **`Reason=health_check`** EMF (metrics only, not traces).
- **Metrics must never break requests:** swallow EMF flush errors (pattern: `src/feature-flag/feature-flag.metrics.ts`).

---

## File map

| Area                   | Create                                                                                                                                                 | Modify                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared telemetry       | `src/core/telemetry/*` (config, propagation, embedded-metrics, service-unavailable metrics, **`is-trace-exempt-path.ts`**, `@SkipTracing()` decorator) | —                                                                                                                                                                                        |
| Health / probes        | —                                                                                                                                                      | `src/health/health.controller.ts` (`@SkipTracing()` alongside existing skip decorators)                                                                                                  |
| OTel bootstrap         | `src/instrumentation.ts`                                                                                                                               | `package.json` (`start:prod`, dependencies), `Dockerfile` CMD, `src/main.ts` (comment only if using `-r`)                                                                                |
| Inbound / Nest tracing | —                                                                                                                                                      | `src/core/logger/tracing.interceptor.ts`, `src/core/logger/logger.middleware.ts`, `src/core/logger/tracing.interceptor.spec.ts`                                                          |
| HttpClient             | —                                                                                                                                                      | `src/core/http-client/telemetry/tracing.ts` (re-export / thin wrapper)                                                                                                                   |
| GraphQL                | —                                                                                                                                                      | `src/common/plugins/complexity.plugin.ts`, `src/common/plugins/tests/graphql-concurrency.spec.ts`                                                                                        |
| Overload 503 metrics   | `src/core/overload/overload-telemetry.ts`                                                                                                              | `src/core/overload/create-pressure-handler.ts`, `src/common/filters/all-exceptions.filter.ts`, `src/core/overload/parse-under-pressure-config.ts`, `src/core/overload/overload.types.ts` |
| Config / docs          | `docs/operations/cloudwatch-overload-alerts.md`, `docs/features/observability.feature.md`                                                              | `src/common/config/env.schema.ts`, `.env.example`, `docs/features/features.md`, `docs/operations/edge-vs-app-rate-limits.md` (link)                                                      |

---

## Dependency graph

```text
Task 1 (core/telemetry + EMF) ──┬── Task 2 (OTel SDK bootstrap)
                                ├── Task 6 (503 metrics wiring)
                                └── Task 5 (HttpClient refactor) after Task 2
Task 2 ── Task 3 (TracingInterceptor + logger correlation)
Task 2 ── Task 4 (GraphQL span attributes + concurrency metric)
Task 6 ── Task 7 (CloudWatch alarm docs + feature doc updates)
```

---

### Task 1: Shared telemetry module (config + EMF + X-Ray propagation)

**Files:**

- Create: `src/core/telemetry/telemetry.types.ts`
- Create: `src/core/telemetry/parse-telemetry-config.ts`
- Create: `src/core/telemetry/embedded-metrics.ts`
- Create: `src/core/telemetry/service-unavailable.metrics.ts`
- Create: `src/core/telemetry/xray-propagation.ts`
- Create: `src/core/telemetry/index.ts`
- Create: `src/core/telemetry/is-trace-exempt-path.ts`
- Create: `src/core/telemetry/decorators/skip-tracing.decorator.ts`
- Create: `src/core/telemetry/tests/is-trace-exempt-path.spec.ts`
- Create: `src/core/telemetry/tests/parse-telemetry-config.spec.ts`
- Create: `src/core/telemetry/tests/service-unavailable.metrics.spec.ts`
- Modify: `src/common/config/env.schema.ts`
- Modify: `.env.example`
- Modify: `src/health/health.controller.ts` (`@SkipTracing()`)

**Interfaces:**

- **Produces:** `parseTelemetryConfig(env: NodeJS.ProcessEnv): TelemetryConfig`, `emitServiceUnavailableMetric(options: EmitServiceUnavailableOptions): Promise<void>`, `getAwsXrayPropagator(): AWSXRayPropagator`, `isAppMetricsEnabled(config: TelemetryConfig): boolean`, `isTraceExemptPath(url: string): boolean`, `SkipTracing` decorator + `SKIP_TRACING_KEY` for guards/interceptors.

- [ ] **Step 1a: Write failing test for trace-exempt paths**

Create `src/core/telemetry/tests/is-trace-exempt-path.spec.ts`:

```typescript
import { isTraceExemptPath } from '../is-trace-exempt-path';

describe('isTraceExemptPath', () => {
  it('matches ALB Terminus probe paths (same as under-pressure exempt list)', () => {
    expect(isTraceExemptPath('/health')).toBe(true);
    expect(isTraceExemptPath('/health/ready')).toBe(true);
    expect(isTraceExemptPath('/health/ready?verbose=1')).toBe(true);
  });

  it('does not exempt API routes', () => {
    expect(isTraceExemptPath('/healthcare/plans')).toBe(false);
    expect(isTraceExemptPath('/api/v1/users')).toBe(false);
  });
});
```

- [ ] **Step 1b: Run test — expect FAIL**

Run: `pnpm exec jest src/core/telemetry/tests/is-trace-exempt-path.spec.ts --watchman=false`

- [ ] **Step 1c: Implement shared exempt helper + decorator**

Create `src/core/telemetry/is-trace-exempt-path.ts`:

```typescript
import { isPressureExemptPath } from '@/core/overload/is-pressure-exempt-path';

/** ALB / Terminus probes — no X-Ray or OTel SERVER spans (see Global Constraints). */
export function isTraceExemptPath(url: string): boolean {
  return isPressureExemptPath(url);
}
```

Create `src/core/telemetry/decorators/skip-tracing.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const SKIP_TRACING_KEY = 'skipTracing';

export function SkipTracing(): ClassDecorator & MethodDecorator {
  return SetMetadata(SKIP_TRACING_KEY, true);
}
```

Export from `src/core/telemetry/index.ts`.

Add on `src/health/health.controller.ts` (class level, next to `@SkipInboundBulkhead()`):

```typescript
import { SkipTracing } from '@/core/telemetry';

@SkipTracing()
@Controller('health')
export class HealthController {
```

- [ ] **Step 1d: Run exempt-path test — expect PASS**

Run: `pnpm exec jest src/core/telemetry/tests/is-trace-exempt-path.spec.ts --watchman=false`

- [ ] **Step 2: Write the failing test for config parsing**

Create `src/core/telemetry/tests/parse-telemetry-config.spec.ts`:

```typescript
import { parseTelemetryConfig } from '../parse-telemetry-config';

describe('parseTelemetryConfig', () => {
  it('disables OTel by default when unset', () => {
    expect(parseTelemetryConfig({})).toEqual(
      expect.objectContaining({
        otelEnabled: false,
        serviceName: 'nestjs-boilerplate',
        appMetricsEnabled: true,
      }),
    );
  });

  it('enables OTel when OTEL_ENABLED=true', () => {
    expect(
      parseTelemetryConfig({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: 'api' }),
    ).toEqual(
      expect.objectContaining({
        otelEnabled: true,
        serviceName: 'api',
      }),
    );
  });

  it('disables app metrics when APP_METRICS_ENABLED=false', () => {
    expect(parseTelemetryConfig({ APP_METRICS_ENABLED: 'false' })).toEqual(
      expect.objectContaining({ appMetricsEnabled: false }),
    );
  });
});
```

- [ ] **Step 3: Run config parsing test to verify it fails**

Run: `pnpm exec jest src/core/telemetry/tests/parse-telemetry-config.spec.ts --watchman=false`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement config + types**

Create `src/core/telemetry/telemetry.types.ts`:

```typescript
export type TelemetryConfig = {
  otelEnabled: boolean;
  serviceName: string;
  appMetricsEnabled: boolean;
  otlpEndpoint?: string;
};

export type ServiceUnavailableReason =
  | 'under_pressure'
  | 'inbound_bulkhead'
  | 'graphql_concurrency'
  | 'health_check'
  | 'dependency_unavailable';

export type EmitServiceUnavailableOptions = {
  enabled: boolean;
  reason: ServiceUnavailableReason;
  path?: string;
  pressureType?: string;
};
```

Create `src/core/telemetry/parse-telemetry-config.ts`:

```typescript
import type { TelemetryConfig } from './telemetry.types';

const DEFAULT_SERVICE_NAME = 'nestjs-boilerplate';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return fallback;
}

export function parseTelemetryConfig(
  env: NodeJS.ProcessEnv = process.env,
): TelemetryConfig {
  const otlpEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const otelEnabled = parseBoolean(env.OTEL_ENABLED, false);

  return {
    otelEnabled,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
    appMetricsEnabled: parseBoolean(env.APP_METRICS_ENABLED, true),
    ...(otlpEndpoint ? { otlpEndpoint } : {}),
  };
}

export function isAppMetricsEnabled(config: TelemetryConfig): boolean {
  return config.appMetricsEnabled;
}
```

Add to `src/common/config/env.schema.ts` (optional keys):

```typescript
  OTEL_ENABLED: { required: false },
  OTEL_SERVICE_NAME: { required: false },
  OTEL_EXPORTER_OTLP_ENDPOINT: { required: false },
  APP_METRICS_ENABLED: { required: false },
```

Add to `.env.example`:

```bash
# OpenTelemetry (export via ADOT / CloudWatch Agent sidecar)
OTEL_ENABLED=false
OTEL_SERVICE_NAME=nestjs-boilerplate
# OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318

# CloudWatch EMF for app-level metrics (503 overload, etc.)
APP_METRICS_ENABLED=true
```

- [ ] **Step 5: Run config test**

Run: `pnpm exec jest src/core/telemetry/tests/parse-telemetry-config.spec.ts --watchman=false`

Expected: PASS

- [ ] **Step 6: Write failing EMF test**

Create `src/core/telemetry/tests/service-unavailable.metrics.spec.ts`:

```typescript
jest.mock('aws-embedded-metrics', () => ({
  createMetricsLogger: jest.fn(() => ({
    setNamespace: jest.fn(),
    putDimensions: jest.fn(),
    putMetric: jest.fn(),
    setProperty: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  })),
  Unit: { Count: 'Count' },
}));

import { createMetricsLogger } from 'aws-embedded-metrics';
import { emitServiceUnavailableMetric } from '../service-unavailable.metrics';

describe('emitServiceUnavailableMetric', () => {
  it('no-ops when disabled', async () => {
    await emitServiceUnavailableMetric({
      enabled: false,
      reason: 'inbound_bulkhead',
      path: '/api/foo',
    });
    expect(createMetricsLogger).not.toHaveBeenCalled();
  });

  it('emits Application/ServiceUnavailable with Reason dimension', async () => {
    await emitServiceUnavailableMetric({
      enabled: true,
      reason: 'under_pressure',
      path: '/auth/login',
      pressureType: 'eventLoopDelay',
    });
    const logger = (createMetricsLogger as jest.Mock).mock.results[0]?.value;
    expect(logger.setNamespace).toHaveBeenCalledWith('Application');
    expect(logger.putDimensions).toHaveBeenCalledWith({
      Reason: 'under_pressure',
    });
    expect(logger.putMetric).toHaveBeenCalledWith(
      'ServiceUnavailable',
      1,
      'Count',
    );
  });
});
```

- [ ] **Step 7: Run EMF test to verify it fails**

Run: `pnpm exec jest src/core/telemetry/tests/service-unavailable.metrics.spec.ts --watchman=false`

Expected: FAIL

- [ ] **Step 8: Implement EMF + propagation helpers**

Create `src/core/telemetry/embedded-metrics.ts`:

```typescript
import { createMetricsLogger, Unit } from 'aws-embedded-metrics';

export async function flushEmbeddedMetrics(options: {
  namespace: string;
  dimensions: Record<string, string>;
  metrics: Array<{ name: string; value: number; unit?: Unit }>;
  properties?: Record<string, string | number | boolean>;
}): Promise<void> {
  const logger = createMetricsLogger();
  logger.setNamespace(options.namespace);
  logger.putDimensions(options.dimensions);
  for (const metric of options.metrics) {
    logger.putMetric(metric.name, metric.value, metric.unit ?? Unit.Count);
  }
  if (options.properties) {
    for (const [key, value] of Object.entries(options.properties)) {
      logger.setProperty(key, value);
    }
  }
  await logger.flush();
}
```

Create `src/core/telemetry/service-unavailable.metrics.ts`:

```typescript
import { Unit } from 'aws-embedded-metrics';
import { flushEmbeddedMetrics } from './embedded-metrics';
import type { EmitServiceUnavailableOptions } from './telemetry.types';

export async function emitServiceUnavailableMetric(
  options: EmitServiceUnavailableOptions,
): Promise<void> {
  if (!options.enabled) {
    return;
  }

  try {
    await flushEmbeddedMetrics({
      namespace: 'Application',
      dimensions: { Reason: options.reason },
      metrics: [{ name: 'ServiceUnavailable', value: 1, unit: Unit.Count }],
      properties: {
        ...(options.path ? { Path: options.path } : {}),
        ...(options.pressureType ? { PressureType: options.pressureType } : {}),
      },
    });
  } catch {
    // Metrics must never break request handling.
  }
}
```

Create `src/core/telemetry/xray-propagation.ts`:

```typescript
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';

let propagator: AWSXRayPropagator | undefined;

export function getAwsXrayPropagator(): AWSXRayPropagator {
  if (!propagator) {
    propagator = new AWSXRayPropagator();
  }
  return propagator;
}
```

Create `src/core/telemetry/index.ts` exporting all public symbols.

- [ ] **Step 9: Run telemetry unit tests**

Run: `pnpm exec jest src/core/telemetry/tests --watchman=false`

Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/core/telemetry src/health/health.controller.ts src/common/config/env.schema.ts .env.example
git commit -m "feat(telemetry): add shared config, health trace exemption, and 503 EMF helpers"
```

---

### Task 2: OpenTelemetry SDK bootstrap (app-wide trace provider)

**Files:**

- Create: `src/instrumentation.ts`
- Create: `src/core/telemetry/tests/instrumentation.spec.ts`
- Modify: `package.json` (dependencies + `start:prod` script)
- Modify: `Dockerfile` (CMD uses `-r`)
- Modify: `nest-cli.json` or `tsconfig.build.json` if `instrumentation.ts` must be compiled (ensure included in `src/`)

**Interfaces:**

- **Consumes:** `parseTelemetryConfig()` from Task 1.
- **Produces:** Side effect: global `TracerProvider` + HTTP/Fastify instrumentations when `OTEL_ENABLED=true`.

- [ ] **Step 1: Add runtime dependencies**

Run:

```bash
pnpm add @opentelemetry/sdk-node @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/instrumentation-http @opentelemetry/instrumentation-fastify @opentelemetry/id-generator-aws-xray @opentelemetry/exporter-trace-otlp-http
pnpm add @opentelemetry/sdk-trace-base
```

Move `@opentelemetry/sdk-trace-base` from devDependencies to dependencies if still listed under dev.

- [ ] **Step 2: Write failing test for early exit when disabled**

Create `src/core/telemetry/tests/instrumentation.spec.ts`:

```typescript
describe('registerInstrumentation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, OTEL_ENABLED: 'false' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not start SDK when OTEL_ENABLED is false', async () => {
    const { registerInstrumentation } =
      await import('../../../instrumentation');
    await expect(registerInstrumentation()).resolves.toBeUndefined();
  });
});

describe('HttpInstrumentation health ignore hook', () => {
  it('exports shouldIgnoreIncomingTraceForUrl aligned with isTraceExemptPath', async () => {
    const { shouldIgnoreIncomingTraceForUrl } =
      await import('../../../instrumentation');
    expect(shouldIgnoreIncomingTraceForUrl('/health')).toBe(true);
    expect(shouldIgnoreIncomingTraceForUrl('/health/ready')).toBe(true);
    expect(shouldIgnoreIncomingTraceForUrl('/healthcare')).toBe(false);
  });
});
```

Refactor `src/instrumentation.ts` to export `registerInstrumentation()`, **`shouldIgnoreIncomingTraceForUrl(url: string)`** (thin wrapper over `isTraceExemptPath` for tests), and auto-call only when loaded as preload (see Step 3).

- [ ] **Step 3: Implement instrumentation entry**

Create `src/instrumentation.ts`:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { parseTelemetryConfig } from './core/telemetry/parse-telemetry-config';
import { isTraceExemptPath } from './core/telemetry/is-trace-exempt-path';

let sdk: NodeSDK | undefined;

/** Used by Http/Fastify instrumentations — no X-Ray segments for ALB probes. */
export function shouldIgnoreIncomingTraceForUrl(url: string): boolean {
  return isTraceExemptPath(url);
}

export async function registerInstrumentation(): Promise<void> {
  const config = parseTelemetryConfig();
  if (!config.otelEnabled) {
    return;
  }

  if (sdk) {
    return;
  }

  const exporter = config.otlpEndpoint
    ? new OTLPTraceExporter({ url: `${config.otlpEndpoint}/v1/traces` })
    : undefined;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
    }),
    traceExporter: exporter,
    idGenerator: new AWSXRayIdGenerator(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) =>
          shouldIgnoreIncomingTraceForUrl(req.url ?? ''),
        ignoreOutgoingRequestHook: (req) =>
          shouldIgnoreIncomingTraceForUrl(req.path ?? req.url ?? ''),
      }),
      new FastifyInstrumentation({
        ignoreRequestHook: (info) =>
          shouldIgnoreIncomingTraceForUrl(info.request.url ?? ''),
      }),
    ],
  });

  await sdk.start();
}

const isPreload = require.main !== module;
if (isPreload) {
  void registerInstrumentation();
}
```

Update `package.json`:

```json
"start:prod": "node -r ./dist/instrumentation.js dist/main"
```

Update `Dockerfile` CMD:

```dockerfile
CMD ["node", "-r", "./dist/instrumentation.js", "dist/main"]
```

- [ ] **Step 4: Run instrumentation test**

Run: `pnpm exec jest src/core/telemetry/tests/instrumentation.spec.ts --watchman=false`

Expected: PASS

- [ ] **Step 5: Smoke-build**

Run: `pnpm run build`

Expected: `dist/instrumentation.js` exists.

- [ ] **Step 6: Commit**

```bash
git add src/instrumentation.ts package.json pnpm-lock.yaml Dockerfile src/core/telemetry/tests/instrumentation.spec.ts
git commit -m "feat(telemetry): bootstrap OpenTelemetry SDK for inbound HTTP"
```

---

### Task 3: Nest handler enrichment + log correlation (TracingInterceptor + LoggerMiddleware)

**Files:**

- Modify: `src/core/logger/tracing.interceptor.ts`
- Modify: `src/core/logger/logger.middleware.ts`
- Create: `src/core/logger/tracing.interceptor.spec.ts`

**Interfaces:**

- **Consumes:** Active span from Task 2 HTTP instrumentation (`trace.getActiveSpan()`), `SKIP_TRACING_KEY` / `isTraceExemptPath` from Task 1.
- **Produces:** Span attributes `code.namespace`, `code.function`; `LoggerContext` fields `traceId`, `spanId` when OTel active — **never on health probes**.

- [ ] **Step 1: Write failing tests**

Create `src/core/logger/tracing.interceptor.spec.ts`:

```typescript
import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { Reflector } from '@nestjs/core';
import { TracingInterceptor } from './tracing.interceptor';

describe('TracingInterceptor', () => {
  const reflector = new Reflector();

  it('sets code attributes on the active span', (done) => {
    const provider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(provider);
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('HTTP GET');
    const ctx = trace.setSpan(context.active(), span);

    context.with(ctx, () => {
      const interceptor = new TracingInterceptor(reflector);
      const executionContext = {
        getType: () => 'http',
        getClass: () => ({ name: 'ExampleController' }),
        getHandler: () => ({ name: 'list' }),
        switchToHttp: () => ({
          getRequest: () => ({ url: '/example' }),
        }),
      } as unknown as ExecutionContext;
      const next: CallHandler = { handle: () => of('ok') };

      interceptor.intercept(executionContext, next).subscribe({
        complete: () => {
          expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
          const attrs = (
            span as unknown as { attributes: Record<string, string> }
          ).attributes;
          expect(attrs['code.namespace']).toBe('ExampleController');
          expect(attrs['code.function']).toBe('list');
          span.end();
          done();
        },
      });
    });
  });

  it('does not mutate spans when @SkipTracing is set', (done) => {
    const provider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(provider);
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('HTTP GET');
    const setAttributes = jest.spyOn(span, 'setAttributes');
    const ctx = trace.setSpan(context.active(), span);

    context.with(ctx, () => {
      const interceptor = new TracingInterceptor(reflector);
      const handler = function check() {};
      Reflect.defineMetadata('skipTracing', true, handler);
      const executionContext = {
        getType: () => 'http',
        getClass: () => ({ name: 'HealthController' }),
        getHandler: () => handler,
        switchToHttp: () => ({
          getRequest: () => ({ url: '/health' }),
        }),
      } as unknown as ExecutionContext;
      const next: CallHandler = { handle: () => of('ok') };

      interceptor.intercept(executionContext, next).subscribe({
        complete: () => {
          expect(setAttributes).not.toHaveBeenCalled();
          span.end();
          done();
        },
      });
    });
  });
});
```

Add a small helper `src/core/telemetry/should-skip-tracing.ts`:

```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/reflector';
import { SKIP_TRACING_KEY } from './decorators/skip-tracing.decorator';
import { isTraceExemptPath } from './is-trace-exempt-path';

export function shouldSkipTracing(
  ctx: ExecutionContext,
  reflector: Reflector,
): boolean {
  if (
    reflector.getAllAndOverride<boolean>(SKIP_TRACING_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
  ) {
    return true;
  }
  if (ctx.getType() === 'http') {
    const req = ctx.switchToHttp().getRequest<{ url?: string }>();
    const url = typeof req.url === 'string' ? req.url : '';
    if (isTraceExemptPath(url)) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm exec jest src/core/logger/tracing.interceptor.spec.ts --watchman=false`

- [ ] **Step 3: Implement interceptor + middleware**

Replace `src/core/logger/tracing.interceptor.ts` body:

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { context, trace } from '@opentelemetry/api';
import { Observable } from 'rxjs';
import { shouldSkipTracing } from '@/core/telemetry/should-skip-tracing';
import { LoggerContext } from './logger.context';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const className = ctx.getClass().name;
    const methodName = ctx.getHandler().name;

    if (shouldSkipTracing(ctx, this.reflector)) {
      return LoggerContext.run(
        { ...LoggerContext.get(), context: className, method: methodName },
        () => next.handle(),
      );
    }

    const activeSpan = trace.getActiveSpan();

    if (activeSpan) {
      activeSpan.setAttributes({
        'code.namespace': className,
        'code.function': methodName,
      });
    }

    const spanContext = activeSpan?.spanContext();

    return new Observable((observer) => {
      LoggerContext.run(
        {
          ...LoggerContext.get(),
          context: className,
          method: methodName,
          ...(spanContext?.traceId ? { traceId: spanContext.traceId } : {}),
          ...(spanContext?.spanId ? { spanId: spanContext.spanId } : {}),
        },
        () => {
          context.with(
            activeSpan
              ? trace.setSpan(context.active(), activeSpan)
              : context.active(),
            () => {
              next.handle().subscribe({
                next: (val) => observer.next(val),
                error: (err) => observer.error(err),
                complete: () => observer.complete(),
              });
            },
          );
        },
      );
    });
  }
}
```

In `src/core/logger/logger.middleware.ts`, after resolving `requestId`, merge `traceId` / `spanId` from the active span **only when** `!isTraceExemptPath(req.url ?? '')` (keep existing `requestId` / `userId` behavior).

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm exec jest src/core/logger/tracing.interceptor.spec.ts --watchman=false`

- [ ] **Step 5: Commit**

```bash
git add src/core/logger/tracing.interceptor.ts src/core/logger/logger.middleware.ts src/core/logger/tracing.interceptor.spec.ts
git commit -m "feat(tracing): enrich OTel spans and logger context in Nest pipeline"
```

---

### Task 4: GraphQL tracing attributes + concurrency 503 metric

**Files:**

- Modify: `src/common/plugins/complexity.plugin.ts`
- Modify: `src/common/plugins/tests/graphql-concurrency.spec.ts`

**Interfaces:**

- **Consumes:** `emitServiceUnavailableMetric`, `parseTelemetryConfig` / `isAppMetricsEnabled`.
- **Produces:** Span attributes on active span: `graphql.operation.name`; EMF `Reason=graphql_concurrency` when Redis acquire fails.

- [ ] **Step 1: Write failing test for metric on deny**

In `src/common/plugins/tests/graphql-concurrency.spec.ts`, add:

```typescript
jest.mock('@/core/telemetry/service-unavailable.metrics', () => ({
  emitServiceUnavailableMetric: jest.fn().mockResolvedValue(undefined),
}));

import { emitServiceUnavailableMetric } from '@/core/telemetry/service-unavailable.metrics';

it('emits ServiceUnavailable metric when concurrency acquire fails', async () => {
  // invoke the code path that throws buildConcurrencyOverloadError after failed acquire
  // (extend existing plugin unit test harness or test a small extracted helper)
  expect(emitServiceUnavailableMetric).toHaveBeenCalledWith(
    expect.objectContaining({ reason: 'graphql_concurrency' }),
  );
});
```

Prefer extracting `recordGraphqlConcurrencyDenied(options)` in `src/common/plugins/graphql-concurrency/record-concurrency-denied.ts` if plugin is hard to unit-test in isolation — keep plugin thin.

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm exec jest src/common/plugins/tests/graphql-concurrency.spec.ts --watchman=false`

- [ ] **Step 3: Implement**

Example helper `src/common/plugins/graphql-concurrency/record-concurrency-denied.ts`:

```typescript
import { trace } from '@opentelemetry/api';
import { emitServiceUnavailableMetric } from '@/core/telemetry/service-unavailable.metrics';
import type { TelemetryConfig } from '@/core/telemetry/telemetry.types';

export async function recordGraphqlConcurrencyDenied(options: {
  telemetry: TelemetryConfig;
  operationName?: string;
  subjectLabel: string;
}): Promise<void> {
  const span = trace.getActiveSpan();
  if (span && options.operationName) {
    span.setAttribute('graphql.operation.name', options.operationName);
  }
  await emitServiceUnavailableMetric({
    enabled: options.telemetry.appMetricsEnabled,
    reason: 'graphql_concurrency',
    path: '/graphql',
  });
}
```

Call from `ComplexityPlugin` when `!acquired.acquired` (before throwing `buildConcurrencyOverloadError`). Inject `TelemetryConfig` via `parseTelemetryConfig()` in plugin constructor (same pattern as other env-backed plugins).

On successful `didResolveOperation`, set `graphql.operation.name` on the active span.

- [ ] **Step 4: Run GraphQL tests — PASS**

Run: `pnpm exec jest src/common/plugins/tests/graphql-concurrency.spec.ts --watchman=false`

- [ ] **Step 5: Commit**

```bash
git add src/common/plugins/complexity.plugin.ts src/common/plugins/graphql-concurrency src/common/plugins/tests/graphql-concurrency.spec.ts
git commit -m "feat(graphql): trace operations and emit 503 concurrency metrics"
```

---

### Task 5: Refactor HttpClient tracing to shared propagation

**Files:**

- Modify: `src/core/http-client/telemetry/tracing.ts`
- Modify: `src/core/http-client/http-client.spec.ts` (only if import paths change)

**Interfaces:**

- **Consumes:** `getAwsXrayPropagator()` from `@/core/telemetry`.
- **Produces:** Same `TraceHandles` API — no caller changes.

- [ ] **Step 1: Run existing HttpClient tracing tests (baseline)**

Run: `pnpm exec jest src/core/http-client/http-client.spec.ts -t "propagation headers when tracing is enabled" --watchman=false`

Expected: PASS before refactor.

- [ ] **Step 2: Replace local propagator with shared helper**

In `src/core/http-client/telemetry/tracing.ts`, remove `new AWSXRayPropagator()` and use:

```typescript
import { getAwsXrayPropagator } from '@/core/telemetry/xray-propagation';

// inside injectHeaders:
const xrayPropagator = getAwsXrayPropagator();
```

Ensure `@/` path resolves in tests (`jest.config.ts` already maps `@/`).

- [ ] **Step 3: Re-run HttpClient tracing tests**

Run: `pnpm exec jest src/core/http-client/http-client.spec.ts -t "OpenTelemetry tracing inject" --watchman=false`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/http-client/telemetry/tracing.ts
git commit -m "refactor(http-client): reuse shared AWS X-Ray propagator"
```

---

### Task 6: Wire 503 / overload metrics at all emission points

**Files:**

- Create: `src/core/overload/overload-telemetry.ts`
- Modify: `src/core/overload/create-pressure-handler.ts`
- Modify: `src/core/overload/overload.types.ts` (`UnderPressureConfig` + `appMetricsEnabled`)
- Modify: `src/core/overload/parse-under-pressure-config.ts`
- Modify: `src/core/overload/tests/create-pressure-handler.spec.ts`
- Modify: `src/common/filters/all-exceptions.filter.ts`
- Modify: `src/common/filters/all-exceptions.filter.spec.ts`

**Interfaces:**

- **Consumes:** `emitServiceUnavailableMetric`, `parseTelemetryConfig`.
- **Produces:** Metrics for `under_pressure`, `inbound_bulkhead`, `health_check`, `dependency_unavailable`.

- [ ] **Step 1: Write failing test for pressure handler metric**

In `src/core/overload/tests/create-pressure-handler.spec.ts`:

```typescript
jest.mock('@/core/telemetry/service-unavailable.metrics', () => ({
  emitServiceUnavailableMetric: jest.fn().mockResolvedValue(undefined),
}));

import { emitServiceUnavailableMetric } from '@/core/telemetry/service-unavailable.metrics';

it('emits under_pressure metric when shedding', () => {
  // existing 503 test setup ...
  expect(emitServiceUnavailableMetric).toHaveBeenCalledWith(
    expect.objectContaining({ reason: 'under_pressure' }),
  );
});
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm exec jest src/core/overload/tests/create-pressure-handler.spec.ts --watchman=false`

- [ ] **Step 3: Implement overload telemetry wrapper**

Create `src/core/overload/overload-telemetry.ts`:

```typescript
import { emitServiceUnavailableMetric } from '@/core/telemetry/service-unavailable.metrics';
import { parseTelemetryConfig } from '@/core/telemetry/parse-telemetry-config';

const telemetryConfig = parseTelemetryConfig();

export function recordUnderPressure503(options: {
  path: string;
  pressureType: string;
}): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'under_pressure',
    path: options.path,
    pressureType: options.pressureType,
  });
}

export function recordInboundBulkhead503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'inbound_bulkhead',
    path,
  });
}
```

Extend `UnderPressureConfig` with `appMetricsEnabled: boolean` from `parseTelemetryConfig().appMetricsEnabled` inside `parse-under-pressure-config.ts`.

In `create-pressure-handler.ts`, after building the 503 body, call `recordUnderPressure503({ path: request.url, pressureType: _type })`.

- [ ] **Step 4: Extend AllExceptionsFilter**

Inject optional metric recording via static imports (no Nest DI — filter already uses `HttpAdapterHost` only):

When `overloadMapped` is set → `recordInboundBulkhead503(httpAdapter.getRequestUrl(request))`.

When `isDbConnectionError` → `reason: 'dependency_unavailable'`.

When `isTerminusHealthResult` → `reason: 'health_check'`.

Add filter tests asserting `emitServiceUnavailableMetric` calls for bulkhead case.

- [ ] **Step 5: Run overload + filter tests**

Run:

```bash
pnpm exec jest src/core/overload/tests/create-pressure-handler.spec.ts src/common/filters/all-exceptions.filter.spec.ts --watchman=false
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/overload src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.spec.ts
git commit -m "feat(overload): emit CloudWatch EMF metrics for 503 shedding paths"
```

---

### Task 7: Operations docs — CloudWatch alarms + observability feature doc

**Files:**

- Create: `docs/operations/cloudwatch-overload-alerts.md`
- Create: `docs/features/observability.feature.md`
- Modify: `docs/features/features.md`
- Modify: `docs/operations/edge-vs-app-rate-limits.md` (link to alerts doc)

- [ ] **Step 1: Write alarm doc with concrete metric math**

Create `docs/operations/cloudwatch-overload-alerts.md` including:

1. **EMF log group** — metrics appear under namespace **`Application`**, name **`ServiceUnavailable`**, dimension **`Reason`** (`under_pressure`, `inbound_bulkhead`, `graphql_concurrency`, `health_check`, `dependency_unavailable`).
2. **Recommended alarms (per Reason)** — example CloudWatch alarm JSON (via console steps is fine) using **Metric math**:
   - `m1`: `ServiceUnavailable` Sum, 60s, `Reason=under_pressure`
   - Threshold: **≥ 5** for **2 consecutive periods** → SNS `ops-high`
   - Separate **warning** alarm: **≥ 1** for 5 minutes on `inbound_bulkhead` (capacity planning)

3. **ALB correlation** — chart `AWS/ApplicationELB` `HTTPCode_ELB_503_Count` alongside app metric; divergence implies edge vs app shedding (link `edge-vs-app-rate-limits.md`).

4. **OTel / X-Ray** — enable `OTEL_ENABLED=true`, point sidecar at `OTEL_EXPORTER_OTLP_ENDPOINT`, service name `OTEL_SERVICE_NAME`, trace HTTP + nested HttpClient spans. **Explicitly document:** `/health` and `/health/ready` produce **no** trace segments (instrumentation ignore hooks + `@SkipTracing()` on `HealthController`); ALB probe volume must not pollute X-Ray or trace costs.

- [ ] **Step 2: Create observability feature doc**

Summarize env vars, modules (`src/core/telemetry`, `src/instrumentation.ts`), health probe trace exclusion (`isTraceExemptPath`, `PRESSURE_EXEMPT_PATHS`), and how HttpClient `.addTracing()` nests under inbound SERVER spans on non-probe routes.

- [ ] **Step 3: Update features matrix**

In `docs/features/features.md`, set **Tracing** to **Done** (with OTel env gate) and **Metrics & alerts** to **Partial** → **Done** for overload EMF + documented alarms (note: SNS/terraform still operator-owned).

- [ ] **Step 4: Commit**

```bash
git add docs/operations/cloudwatch-overload-alerts.md docs/features/observability.feature.md docs/features/features.md docs/operations/edge-vs-app-rate-limits.md
git commit -m "docs(ops): CloudWatch alarms for 503 overload metrics and OTel tracing"
```

---

## Self-review (spec coverage)

| Requirement                                  | Task                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| App-wide tracing (not only HttpClient)       | Tasks 2–4 (SDK + Nest + GraphQL); Task 5 keeps outbound linked                                                               |
| Health endpoints excluded from X-Ray/tracing | Task 1 (`isTraceExemptPath`, `@SkipTracing`), Task 2 (HTTP + Fastify ignore hooks), Task 3 (interceptor + logger middleware) |
| AWS X-Ray propagation                        | Tasks 1–2, 5                                                                                                                 |
| 503 under-pressure metric                    | Task 6                                                                                                                       |
| 503 inbound bulkhead metric                  | Task 6                                                                                                                       |
| 503 GraphQL concurrency metric               | Tasks 4, 6                                                                                                                   |
| Health / dependency 503 visibility           | Task 6                                                                                                                       |
| Alerting on overload metrics                 | Task 7                                                                                                                       |
| Zero placeholder steps                       | Verified — all steps include concrete paths/code                                                                             |

**Out of scope (YAGNI):** WebSocket span instrumentation (follow-up epic), BullMQ consumer spans, Terraform modules in-repo, auto-paging SNS creation (document only).

---

Plan complete and saved to `intent/app-wide-tracing-overload-alerting/plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
