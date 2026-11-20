# Security Audit Remediation (2026-11-21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close confirmed findings **SEC-AUD-001**–**003** and harden **SEC-AUD-004**–**006** from [security-audit-report.md](../../reports/2026-11-21-security-audit/security-audit-report.md) so production forks meet the repo security baseline.

**Architecture:** Centralize environment-driven security switches in `src/common/config/` (mirror existing WebSocket origin guards). Gate demo/conformance surfaces at module import and HTTP boundary. Reconcile JWT authorization from MongoDB on every authenticated request in `AccessTokenAuthenticator` (same path as `JwtStrategy`).

**Tech Stack:** NestJS 12 + Fastify, Apollo GraphQL, MongoDB (Mongoose), Jest, pnpm.

## Global Constraints

- Node **24.9+** (`.nvmrc`); package manager **pnpm only**; never hand-edit `pnpm-lock.yaml`.
- Imports use `@/` alias; named exports only; exhaustive `never` in switches.
- Every behavior change gets a unit or integration test that fails without the fix; do not weaken existing tests.
- Before calling done: `pnpm quality:lint`, `pnpm quality:types`, `pnpm test:unit` (report results). Run integration tests when touching auth, health HTTP, or env validation.
- Public docs: update `docs/threat-model.md` and affected `docs/features/*.feature.md` in the same change set as code.
- No new dependencies without `/add-dependency`.
- Do not set human acceptance status on intents; this plan implements audit remediation only.

## File map (planned)

| Area                        | Create                                                                                                                                                           | Modify                                                                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GraphQL IDE / introspection | `src/common/config/parse-graphql-driver-config.ts`, `src/common/config/tests/parse-graphql-driver-config.spec.ts`                                                | `src/app.module.ts`                                                                                                                                                                                             |
| Example jobs surface        | `src/common/config/is-example-jobs-api-enabled.ts`, `src/common/config/tests/is-example-jobs-api-enabled.spec.ts`, `src/example/example-jobs-handlers.module.ts` | `src/app.module.ts`, `src/example/example-jobs.controller.ts`, `src/example/example-jobs.module.ts`, `docs/features/background_jobs.feature.md`                                                                 |
| JWT role reconciliation     | —                                                                                                                                                                | `src/auth/auth.service.ts`, `src/auth/access-token-authenticator.service.ts`, `src/auth/tests/access-token-authenticator.service.spec.ts`, `src/auth/tests/auth.service.spec.ts` (if present)                   |
| HTTP CORS                   | `src/common/config/resolve-cors-origins.ts`, `src/common/config/tests/resolve-cors-origins.spec.ts`                                                              | `src/main.ts`, `src/core/websocket/config/parse-websocket-config.ts`, `src/common/config/validate-env.ts`                                                                                                       |
| Conformance harness         | `src/conformance/guards/conformance-harness-auth.guard.ts`, `src/conformance/tests/conformance-harness-auth.guard.spec.ts`                                       | `src/conformance/conformance.module.ts`, `src/common/config/validate-env.ts`, `src/common/config/env.schema.ts`, `src/common/config/tests/validate-env.spec.ts`, `docs/features/conformance_harness.feature.md` |
| Health exposure             | `src/core/health/resolve-health-response-mode.ts`, `src/core/health/tests/resolve-health-response-mode.spec.ts`                                                  | `src/core/health/health.controller.ts`, `src/core/health/tests/health.controller.spec.ts`, `docs/features/health.feature.md` (if exists) or `docs/operations/`                                                  |
| Threat model                | —                                                                                                                                                                | `docs/threat-model.md`                                                                                                                                                                                          |

---

### Task 1: GraphQL production hardening (SEC-AUD-001)

**Files:**

- Create: `src/common/config/parse-graphql-driver-config.ts`
- Create: `src/common/config/tests/parse-graphql-driver-config.spec.ts`
- Modify: `src/app.module.ts` (GraphQLModule block ~187–203)
- Export: `src/common/config/index.ts` (if barrel exports config helpers)

**Interfaces:**

- Consumes: `ConfigService.get('NODE_ENV')`.
- Produces: `parseGraphQlDriverOptions(configService: Pick<ConfigService, 'get'>): { graphiql: boolean; introspection: boolean }`

- [ ] **Step 1: Write the failing test**

```typescript
// src/common/config/tests/parse-graphql-driver-config.spec.ts
import { parseGraphQlDriverOptions } from '../parse-graphql-driver-config';

describe('parseGraphQlDriverOptions', () => {
  it('enables graphiql and introspection in development', () => {
    const options = parseGraphQlDriverOptions({
      get: (key: string) => (key === 'NODE_ENV' ? 'development' : undefined),
    } as never);
    expect(options).toEqual({ graphiql: true, introspection: true });
  });

  it('disables graphiql and introspection in production', () => {
    const options = parseGraphQlDriverOptions({
      get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined),
    } as never);
    expect(options).toEqual({ graphiql: false, introspection: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest --config jest.config.ts src/common/config/tests/parse-graphql-driver-config.spec.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Implement parser**

```typescript
// src/common/config/parse-graphql-driver-config.ts
import { ConfigService } from '@nestjs/config';

export type GraphQlDriverSecurityOptions = {
  graphiql: boolean;
  introspection: boolean;
};

export function parseGraphQlDriverOptions(
  configService: Pick<ConfigService, 'get'>,
): GraphQlDriverSecurityOptions {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';
  return {
    graphiql: !isProduction,
    introspection: !isProduction,
  };
}
```

- [ ] **Step 4: Wire GraphQLModule with ConfigService**

Refactor `GraphQLModule.forRoot` → `GraphQLModule.forRootAsync` in `src/app.module.ts`:

```typescript
GraphQLModule.forRootAsync<ApolloDriverConfig>({
  driver: ApolloDriver,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const security = parseGraphQlDriverOptions(configService);
    return {
      typePaths: ['./**/*.graphql'],
      context: ({
        request,
        reply,
      }: {
        request: FastifyRequest;
        reply: FastifyReply;
      }) => ({ req: request, res: reply }),
      definitions: {
        path: join(process.cwd(), 'src/graphql.ts'),
        outputAs: 'class',
      },
      graphiql: security.graphiql,
      introspection: security.introspection,
      validationRules: [depthLimit(10)],
    };
  },
}),
```

Add required imports (`ConfigService`, `parseGraphQlDriverOptions`, `FastifyRequest`, `FastifyReply` if not already present).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec jest --config jest.config.ts src/common/config/tests/parse-graphql-driver-config.spec.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/common/config/parse-graphql-driver-config.ts src/common/config/tests/parse-graphql-driver-config.spec.ts src/app.module.ts src/common/config/index.ts
git commit -m "fix(security): disable GraphiQL and introspection in production"
```

---

### Task 2: Example background-jobs API gate (SEC-AUD-002)

**Files:**

- Create: `src/common/config/is-example-jobs-api-enabled.ts`
- Create: `src/common/config/tests/is-example-jobs-api-enabled.spec.ts`
- Create: `src/example/example-jobs-handlers.module.ts` (handlers only, no HTTP controller)
- Modify: `src/example/example-jobs.module.ts`
- Modify: `src/example/example-jobs.controller.ts`
- Modify: `src/app.module.ts` (~112–118)
- Modify: `docs/features/background_jobs.feature.md`
- Test: `src/example/tests/example-jobs.controller.spec.ts`

**Interfaces:**

- Consumes: `NODE_ENV`, optional `EXAMPLE_JOBS_API_ENABLED` (new env, default off in production).
- Produces: `isExampleJobsApiEnabled(env?: NodeJS.ProcessEnv): boolean`
- Produces: `ExampleJobsHandlersModule` — registers `ExampleEchoJobHandler` + `ExampleJobsHandlersRegistration` without HTTP.

- [ ] **Step 1: Write failing tests for env gate**

```typescript
// src/common/config/tests/is-example-jobs-api-enabled.spec.ts
import { isExampleJobsApiEnabled } from '../is-example-jobs-api-enabled';

describe('isExampleJobsApiEnabled', () => {
  it('is false in production by default', () => {
    expect(isExampleJobsApiEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is true in development by default', () => {
    expect(isExampleJobsApiEnabled({ NODE_ENV: 'development' })).toBe(true);
  });

  it('is true in production when EXAMPLE_JOBS_API_ENABLED=true', () => {
    expect(
      isExampleJobsApiEnabled({
        NODE_ENV: 'production',
        EXAMPLE_JOBS_API_ENABLED: 'true',
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run gate tests — expect FAIL**

Run: `pnpm exec jest --config jest.config.ts src/common/config/tests/is-example-jobs-api-enabled.spec.ts`

- [ ] **Step 3: Implement gate + env schema entry**

```typescript
// src/common/config/is-example-jobs-api-enabled.ts
export function isExampleJobsApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.EXAMPLE_JOBS_API_ENABLED === 'true') {
    return true;
  }
  if (env.EXAMPLE_JOBS_API_ENABLED === 'false') {
    return false;
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  return nodeEnv !== 'production';
}
```

Add to `src/common/config/env.schema.ts`:

```typescript
EXAMPLE_JOBS_API_ENABLED: { required: false },
```

Add commented line to `.env.example`: `# EXAMPLE_JOBS_API_ENABLED=false  # demo POST /example/jobs/echo; default off in production`

- [ ] **Step 4: Split handlers from HTTP module**

`example-jobs-handlers.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ExampleJobsHandlersRegistration } from './example-jobs-handlers.registration';
import { ExampleEchoJobHandler } from './jobs/example-echo.job-handler';

@Module({
  providers: [ExampleEchoJobHandler, ExampleJobsHandlersRegistration],
})
export class ExampleJobsHandlersModule {}
```

`example-jobs.module.ts` — keep only controller:

```typescript
import { Module } from '@nestjs/common';
import { ExampleJobsController } from './example-jobs.controller';

@Module({
  controllers: [ExampleJobsController],
})
export class ExampleJobsModule {}
```

`app.module.ts` conditional:

```typescript
...(isBackgroundJobsEnabled()
  ? [
      BackgroundJobsModule.forRootAsync({
        registerWorker: process.env.BACKGROUND_WORKER_ENABLED === 'true',
      }),
      ExampleJobsHandlersModule,
      ...(isExampleJobsApiEnabled() ? [ExampleJobsModule] : []),
    ]
  : []),
```

- [ ] **Step 5: Remove `@Public()` from controller**

Delete `Public` import and `@Public()` decorator from `src/example/example-jobs.controller.ts`. Route inherits global `JwtAuthGuard`.

- [ ] **Step 6: Update controller unit test (still valid — tests controller in isolation)**

No change required to enqueue logic test unless imports break.

- [ ] **Step 7: Run tests**

Run: `pnpm exec jest --config jest.config.ts src/common/config/tests/is-example-jobs-api-enabled.spec.ts src/example/tests/example-jobs.controller.spec.ts`

Expected: PASS

- [ ] **Step 8: Update feature doc**

In `docs/features/background_jobs.feature.md`, replace “public, like other example routes” with: JWT required; `ExampleJobsModule` not registered when `NODE_ENV=production` unless `EXAMPLE_JOBS_API_ENABLED=true`.

- [ ] **Step 9: Commit**

```bash
git add src/common/config/is-example-jobs-api-enabled.ts src/common/config/tests/is-example-jobs-api-enabled.spec.ts src/example/example-jobs-handlers.module.ts src/example/example-jobs.module.ts src/example/example-jobs.controller.ts src/app.module.ts src/common/config/env.schema.ts .env.example docs/features/background_jobs.feature.md
git commit -m "fix(security): gate and authenticate example job enqueue API"
```

---

### Task 3: Authoritative JWT role from MongoDB (SEC-AUD-003)

**Files:**

- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/access-token-authenticator.service.ts`
- Modify: `src/auth/tests/access-token-authenticator.service.spec.ts`

**Interfaces:**

- Consumes: existing `AuthService.isRevoked(jti)`.
- Produces: `AuthService.resolveAuthoritativeRoleForUserId(userId: string): Promise<UserRole>` — throws `UnauthorizedException` when user missing or inactive; runs `ensureAdminRoleIfAllowlisted` before returning role (same semantics as login/refresh).

- [ ] **Step 1: Write failing tests**

Extend `src/auth/tests/access-token-authenticator.service.spec.ts`:

```typescript
it('uses role from AuthService, not stale JWT claim', async () => {
  (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
    sub: 'user-1',
    email: 'a@example.com',
    jti: 'jti-1',
    role: UserRole.ADMIN,
  });
  (authService.isRevoked as jest.Mock).mockResolvedValue(false);
  (
    authService.resolveAuthoritativeRoleForUserId as jest.Mock
  ).mockResolvedValue(UserRole.USER);

  await expect(authenticator.verifyAccessToken('tok')).resolves.toEqual({
    id: 'user-1',
    email: 'a@example.com',
    jti: 'jti-1',
    role: UserRole.USER,
  });
});

it('rejects when authoritative role lookup fails', async () => {
  (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
    sub: 'user-1',
    email: 'a@example.com',
    jti: 'jti-1',
    role: UserRole.USER,
  });
  (authService.isRevoked as jest.Mock).mockResolvedValue(false);
  (
    authService.resolveAuthoritativeRoleForUserId as jest.Mock
  ).mockRejectedValue(new UnauthorizedException('User not found'));

  await expect(authenticator.verifyAccessToken('tok')).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
});
```

Update the mock `authService` in the spec to include `resolveAuthoritativeRoleForUserId: jest.fn()`.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm exec jest --config jest.config.ts src/auth/tests/access-token-authenticator.service.spec.ts`

- [ ] **Step 3: Implement AuthService resolver**

Add public method on `AuthService`:

```typescript
async resolveAuthoritativeRoleForUserId(userId: string): Promise<UserRole> {
  const user = await this.userModel.findById(userId).exec();
  if (!user?.isActive) {
    throw new UnauthorizedException('User not found');
  }
  return this.ensureAdminRoleIfAllowlisted(user);
}
```

- [ ] **Step 4: Reconcile in AccessTokenAuthenticator**

Replace JWT `role` assignment in `userFromVerifiedPayload`:

```typescript
const role = await this.authService.resolveAuthoritativeRoleForUserId(
  payload.sub,
);

return {
  id: payload.sub,
  email: payload.email,
  jti: payload.jti,
  role,
};
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm exec jest --config jest.config.ts src/auth/tests/access-token-authenticator.service.spec.ts`

- [ ] **Step 6: Commit**

```bash
git add src/auth/auth.service.ts src/auth/access-token-authenticator.service.ts src/auth/tests/access-token-authenticator.service.spec.ts
git commit -m "fix(security): reconcile JWT role from database on each auth"
```

---

### Task 4: HTTP CORS production fail-closed (SEC-AUD-004)

**Files:**

- Create: `src/common/config/resolve-cors-origins.ts` (exports `resolveCorsOrigins`, `assertProductionAllowedOrigins`, `toFastifyCorsOrigin`)
- Create: `src/common/config/tests/resolve-cors-origins.spec.ts`
- Modify: `src/core/websocket/config/parse-websocket-config.ts` (import shared resolver; delete local duplicate)
- Modify: `src/main.ts` (~145–148)
- Modify: `src/common/config/validate-env.ts` + `src/common/config/tests/validate-env.spec.ts` (optional duplicate guard at config validate)

**Interfaces:**

- Produces: `resolveCorsOrigins(configService): { mode: 'allow-all' } | { mode: 'list'; origins: string[] }`
- Produces: `assertProductionAllowedOrigins(nodeEnv: string, origins: string[]): void` — throws if `nodeEnv === 'production'` && `origins.length === 0`
- Produces: `toFastifyCorsOrigin(resolveResult): boolean | string[]` — `allow-all` → `true` in dev only; never `'*'` with `credentials: true`

- [ ] **Step 1: Write failing tests**

```typescript
// src/common/config/tests/resolve-cors-origins.spec.ts
import {
  resolveCorsOrigins,
  assertProductionAllowedOrigins,
  toFastifyCorsOrigin,
} from '../resolve-cors-origins';

describe('resolveCorsOrigins', () => {
  it('requires explicit list in production', () => {
    const resolved = resolveCorsOrigins({
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ALLOWED_ORIGINS') return 'https://app.example.com';
        return undefined;
      },
    } as never);
    expect(resolved).toEqual({
      mode: 'list',
      origins: ['https://app.example.com'],
    });
  });

  it('allows all in development when origins unset', () => {
    const resolved = resolveCorsOrigins({
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      },
    } as never);
    expect(resolved).toEqual({ mode: 'allow-all' });
  });
});

describe('assertProductionAllowedOrigins', () => {
  it('throws when production has empty origins', () => {
    expect(() => assertProductionAllowedOrigins('production', [])).toThrow(
      /ALLOWED_ORIGINS/,
    );
  });
});

describe('toFastifyCorsOrigin', () => {
  it('never returns asterisk string', () => {
    expect(toFastifyCorsOrigin({ mode: 'allow-all' })).toBe(true);
    expect(
      toFastifyCorsOrigin({ mode: 'list', origins: ['https://a'] }),
    ).toEqual(['https://a']);
  });
});
```

- [ ] **Step 2: Run tests — FAIL**

Run: `pnpm exec jest --config jest.config.ts src/common/config/tests/resolve-cors-origins.spec.ts`

- [ ] **Step 3: Implement shared CORS helpers** (move logic from `parse-websocket-config.ts` `resolveCorsOrigins` verbatim into new file; re-export for websocket parser).

- [ ] **Step 4: Update `main.ts`**

After `NestFactory.create`, before `enableCors`:

```typescript
const corsResolved = resolveCorsOrigins(configService);
if (corsResolved.mode === 'list') {
  assertProductionAllowedOrigins(
    configService.get<string>('NODE_ENV') ?? 'development',
    corsResolved.origins,
  );
}
app.enableCors({
  origin: toFastifyCorsOrigin(corsResolved),
  credentials: true,
});
```

Remove `process.env.ALLOWED_ORIGINS?.split(',') || '*'`.

- [ ] **Step 5: Refactor websocket config** to import `resolveCorsOrigins` from `@/common/config/resolve-cors-origins`; run existing websocket config tests.

Run: `pnpm exec jest --config jest.config.ts src/core/websocket/config/tests/parse-websocket-config.spec.ts src/common/config/tests/resolve-cors-origins.spec.ts`

- [ ] **Step 6: Add validateEnv production guard (belt and suspenders)**

In `validate-env.ts`, after required-key loop:

```typescript
if (config.NODE_ENV === 'production') {
  const raw = config.ALLOWED_ORIGINS;
  const origins =
    typeof raw === 'string'
      ? raw
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : [];
  if (origins.length === 0) {
    throw new Error('ALLOWED_ORIGINS is required when NODE_ENV=production');
  }
}
```

Add matching test in `validate-env.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/common/config/resolve-cors-origins.ts src/common/config/tests/resolve-cors-origins.spec.ts src/main.ts src/core/websocket/config/parse-websocket-config.ts src/common/config/validate-env.ts src/common/config/tests/validate-env.spec.ts
git commit -m "fix(security): fail closed on HTTP CORS in production"
```

---

### Task 5: Conformance harness authentication (SEC-AUD-005)

**Files:**

- Create: `src/conformance/guards/conformance-harness-auth.guard.ts`
- Create: `src/conformance/tests/conformance-harness-auth.guard.spec.ts`
- Modify: `src/conformance/conformance.module.ts`
- Modify: `src/common/config/env.schema.ts`, `validate-env.ts`, `validate-env.spec.ts`
- Modify: `docs/features/conformance_harness.feature.md`

**Interfaces:**

- Env: `CONFORMANCE_HARNESS_TOKEN` — required (non-empty) when `CONFORMANCE_HARNESS_ENABLED=true`.
- Produces: `ConformanceHarnessAuthGuard` — compares `Authorization: Bearer <token>` to env using `crypto.timingSafeEqual` on equal-length buffers; otherwise `UnauthorizedException`.

- [ ] **Step 1: Write failing guard test**

```typescript
// src/conformance/tests/conformance-harness-auth.guard.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import { ConformanceHarnessAuthGuard } from '../guards/conformance-harness-auth.guard';

describe('ConformanceHarnessAuthGuard', () => {
  it('rejects missing bearer token', () => {
    const guard = new ConformanceHarnessAuthGuard({
      get: () => 'secret-token',
    } as never);
    expect(() =>
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as never),
    ).toThrow(UnauthorizedException);
  });

  it('accepts matching bearer token', () => {
    const guard = new ConformanceHarnessAuthGuard({
      get: () => 'secret-token',
    } as never);
    expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: 'Bearer secret-token' },
          }),
        }),
      } as never),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm exec jest --config jest.config.ts src/conformance/tests/conformance-harness-auth.guard.spec.ts`

- [ ] **Step 3: Implement guard** (`CanActivate`, read header, timing-safe compare).

- [ ] **Step 4: Protect all conformance controllers**

On each of these six controllers, remove `@Public()` and add class-level `@UseGuards(ConformanceHarnessAuthGuard)`:

- `src/conformance/conformance-cache.controller.ts`
- `src/conformance/conformance-http-client.controller.ts`
- `src/conformance/conformance-deadline.controller.ts`
- `src/conformance/conformance-priority.controller.ts`
- `src/conformance/conformance-rate-limit.controller.ts`
- `src/conformance/conformance-redaction.controller.ts`

Register `ConformanceHarnessAuthGuard` in `conformance.module.ts` `providers` (and `exports` if tests need it). Update decorator-focused specs (e.g. `conformance-redaction.controller.spec.ts`) to assert `@UseGuards(ConformanceHarnessAuthGuard)` instead of `@Public()`.

- [ ] **Step 5: validateEnv rules**

When `CONFORMANCE_HARNESS_ENABLED === 'true'`:

- Require non-empty `CONFORMANCE_HARNESS_TOKEN`.
- Throw when `HTTP_CLIENT_ALLOW_PRIVATE_URLS === 'true'` and `NODE_ENV` is `staging` or `development` (allow only in `test`):

```typescript
if (
  config.CONFORMANCE_HARNESS_ENABLED === 'true' &&
  config.HTTP_CLIENT_ALLOW_PRIVATE_URLS === 'true' &&
  config.NODE_ENV !== 'test'
) {
  throw new Error(
    'HTTP_CLIENT_ALLOW_PRIVATE_URLS cannot be true when CONFORMANCE_HARNESS_ENABLED=true outside NODE_ENV=test',
  );
}
```

Add tests in `validate-env.spec.ts`.

- [ ] **Step 6: Document token in conformance feature doc** — external harness must send `Authorization: Bearer $CONFORMANCE_HARNESS_TOKEN`.

- [ ] **Step 7: Run conformance + validate tests**

Run: `pnpm exec jest --config jest.config.ts src/conformance/tests/ src/common/config/tests/validate-env.spec.ts`

- [ ] **Step 8: Commit**

```bash
git add src/conformance/guards/conformance-harness-auth.guard.ts src/conformance/tests/conformance-harness-auth.guard.spec.ts src/conformance/conformance.module.ts src/conformance/*.controller.ts src/conformance/tests/*.spec.ts src/common/config/validate-env.ts src/common/config/env.schema.ts src/common/config/tests/validate-env.spec.ts docs/features/conformance_harness.feature.md .env.example
git commit -m "fix(security): require bearer token for conformance harness routes"
```

---

### Task 6: Minimize public health dependency detail (SEC-AUD-006)

**Files:**

- Create: `src/core/health/resolve-health-response-mode.ts`
- Create: `src/core/health/tests/resolve-health-response-mode.spec.ts`
- Modify: `src/core/health/health.controller.ts`
- Modify: `src/core/health/tests/health.controller.spec.ts`

**Interfaces:**

- Produces: `resolveHealthResponseMode(configService): 'minimal' | 'detailed'`
- Rule: `minimal` when `NODE_ENV=production` and `HEALTH_EXPOSE_DEPENDENCIES` is not `true`; else `detailed`.

- [ ] **Step 1: Write failing tests for mode resolver**

```typescript
import { resolveHealthResponseMode } from '../resolve-health-response-mode';

describe('resolveHealthResponseMode', () => {
  it('is minimal in production by default', () => {
    expect(
      resolveHealthResponseMode({
        get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined),
      } as never),
    ).toBe('minimal');
  });

  it('is detailed when HEALTH_EXPOSE_DEPENDENCIES=true', () => {
    expect(
      resolveHealthResponseMode({
        get: (key: string) => {
          if (key === 'NODE_ENV') return 'production';
          if (key === 'HEALTH_EXPOSE_DEPENDENCIES') return 'true';
          return undefined;
        },
      } as never),
    ).toBe('detailed');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement resolver + env schema** `HEALTH_EXPOSE_DEPENDENCIES: { required: false }`

- [ ] **Step 4: Change `check()` and `ready()`**

When mode is `minimal`, still run `this.health.check(this.buildChecks())` for correct HTTP status, but map the response body to:

```typescript
{
  status: result.status === 'ok' ? 'ok' : 'error',
}
```

Do not expose per-indicator keys (`mongo`, `redis`, `postgres`, `storage`, etc.) in the JSON. On failure, keep HTTP 503 from Terminus behavior.

Add controller unit tests asserting `minimal` mode strips `info`/`details`.

- [ ] **Step 5: Run health unit tests**

Run: `pnpm exec jest --config jest.config.ts src/core/health/tests/health.controller.spec.ts src/core/health/tests/resolve-health-response-mode.spec.ts`

- [ ] **Step 6: Commit**

```bash
git add src/core/health/resolve-health-response-mode.ts src/core/health/tests/resolve-health-response-mode.spec.ts src/core/health/health.controller.ts src/core/health/tests/health.controller.spec.ts src/common/config/env.schema.ts
git commit -m "fix(security): minimize dependency detail on public health endpoints"
```

---

### Task 7: Threat model and audit traceability

**Files:**

- Modify: `docs/threat-model.md`
- Modify: `docs/reports/2026-11-21-security-audit/security-audit-report.md` (add “Remediation” subsection linking to this plan — optional)

- [ ] **Step 1: Update threat model** with the five bullets from the audit “Threat model updates required” section (GraphiQL/introspection, example modules, conformance harness, JWT role staleness — mark as mitigated with file references — HTTP vs WebSocket CORS alignment).

- [ ] **Step 2: Add short “Security baseline controls” subsection** listing env vars: `ALLOWED_ORIGINS`, `EXAMPLE_JOBS_API_ENABLED`, `CONFORMANCE_HARNESS_TOKEN`, `HEALTH_EXPOSE_DEPENDENCIES`.

- [ ] **Step 3: Commit**

```bash
git add docs/threat-model.md
git commit -m "docs(security): record audit remediations in threat model"
```

---

### Task 8: Final verification gate

- [ ] **Step 1: Lint**

Run: `pnpm quality:lint`

Expected: 0 errors

- [ ] **Step 2: Types**

Run: `pnpm quality:types`

Expected: pass

- [ ] **Step 3: Unit tests**

Run: `pnpm test:unit`

Expected: pass

- [ ] **Step 4: Spot-check integration** (if Docker available)

Run: `pnpm test:integration` — focus on auth/health env if failures appear.

- [ ] **Step 5: Reconcile with audit IDs**

| Finding     | Task   |
| ----------- | ------ |
| SEC-AUD-001 | Task 1 |
| SEC-AUD-002 | Task 2 |
| SEC-AUD-003 | Task 3 |
| SEC-AUD-004 | Task 4 |
| SEC-AUD-005 | Task 5 |
| SEC-AUD-006 | Task 6 |

---

## Self-review (plan author checklist)

**Spec coverage:** All six audit items (3 confirmed + 3 needs-validation) map to Tasks 1–6; threat-model doc in Task 7.

**Placeholder scan:** No TBD/TODO steps; each task includes concrete code and commands.

**Type consistency:** `resolveAuthoritativeRoleForUserId` used consistently in authenticator tests and implementation; shared CORS types used by `main.ts` and websocket parser.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-21-security-audit-remediation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks (REQUIRED SUB-SKILL: superpowers:subagent-driven-development).

2. **Inline Execution** — execute tasks in this session with checkpoints (REQUIRED SUB-SKILL: superpowers:executing-plans).

Which approach?
