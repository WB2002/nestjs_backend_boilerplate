# Cookie-Based SPA CSRF Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect state-changing HTTP requests when the browser automatically sends auth cookies (`access_token`, `session_id`) by enforcing the **double-submit cookie** pattern, while leaving **Bearer-only** mobile/API clients unchanged.

**Architecture:** Add a global `src/core/csrf/` module with token generation, cookie/header helpers, and **`CsrfMiddleware`** (not an `APP_GUARD`, so GraphQL `POST /graphql` is validated once per request). Expose **`GET /auth/csrf`** for SPA bootstrap and rotate the CSRF cookie on login/refresh. Enforce only on **unsafe methods** when a session cookie is present and the client did not send **`Authorization: Bearer`**.

**Tech Stack:** NestJS 11, Fastify 5, `@fastify/cookie` (existing), Node `crypto`, Jest (`pnpm test --watchman=false`).

## Global Constraints

- **Runtime:** Node **22+**; package manager **pnpm**; tests via **`pnpm test --watchman=false`**.
- **HTTP server:** **Fastify** via `@nestjs/platform-fastify`; cookies registered in `main.ts` with **`COOKIE_SECRET`** (required).
- **Imports:** Top of file only (no inline imports) per workspace rule.
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Path alias:** `@/*` → `src/*`.
- **Auth cookies (existing):** `access_token` (`ACCESS_TOKEN_COOKIE`), `session_id` (`SESSION_ID_COOKIE`) — httpOnly, SameSite=strict per `src/common/utils/cookie.utils.ts`.
- **CSRF defaults:** Header **`X-CSRF-Token`**, readable cookie **`csrf_token`** (not httpOnly); compare with **`crypto.timingSafeEqual`** after normalizing to equal-length buffers.
- **Fail closed when enabled:** Invalid/missing token → **403** with a stable error code (not 401).

---

## File map

| Area | Create | Modify |
| ---- | ------ | ------ |
| Core CSRF | `src/core/csrf/**` (constants, types, helpers, service, middleware, module, errors, index) | — |
| Cookies | — | `src/common/constants/cookie.constant.ts`, `src/common/utils/cookie.utils.ts` |
| Auth bootstrap | — | `src/auth/auth.controller.ts` |
| Wiring | — | `src/app.module.ts`, `src/common/config/env.schema.ts`, `.env.example` |
| Tests | `src/core/csrf/**/*.spec.ts`, `src/core/csrf/csrf.http.spec.ts` | `src/common/config/validate-env.spec.ts` (if new required keys — none planned) |
| Docs | `docs/features/csrf.feature.md` | `docs/features/features.md`, `docs/features/auth.feature.md` |

---

### Task 1: CSRF constants, types, and token service

**Files:**
- Create: `src/core/csrf/constants/csrf.constants.ts`
- Create: `src/core/csrf/constants/index.ts`
- Create: `src/core/csrf/types/csrf.types.ts`
- Create: `src/core/csrf/types/index.ts`
- Create: `src/core/csrf/helpers/csrf-token.ts`
- Create: `src/core/csrf/helpers/index.ts`
- Create: `src/core/csrf/csrf-token.service.ts`
- Create: `src/core/csrf/csrf-token.service.spec.ts`

**Interfaces:**
- Produces: `CSRF_TOKEN_HEADER = 'x-csrf-token'` (lookup is case-insensitive on Fastify)
- Note: `CSRF_TOKEN_COOKIE` is added in Task 2 in `src/common/constants/cookie.constant.ts`; import it from `@/common/constants` in CSRF code.
- Produces: `CsrfTokenService.generateToken(): string` — 32 random bytes, base64url, no padding
- Produces: `CsrfTokenService.tokensMatch(cookieValue: string | undefined, headerValue: string | undefined): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/core/csrf/csrf-token.service.spec.ts`:

```typescript
import { CsrfTokenService } from './csrf-token.service';

describe('CsrfTokenService', () => {
  const service = new CsrfTokenService();

  it('generateToken returns url-safe strings of fixed length', () => {
    const a = service.generateToken();
    const b = service.generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toEqual(b);
  });

  it('tokensMatch accepts equal cookie and header values', () => {
    const token = service.generateToken();
    expect(service.tokensMatch(token, token)).toBe(true);
  });

  it('tokensMatch rejects missing or mismatched values', () => {
    const token = service.generateToken();
    expect(service.tokensMatch(undefined, token)).toBe(false);
    expect(service.tokensMatch(token, undefined)).toBe(false);
    expect(service.tokensMatch(token, `${token}x`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --watchman=false src/core/csrf/csrf-token.service.spec.ts`
Expected: FAIL — module `./csrf-token.service` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/csrf/helpers/csrf-token.ts`:

```typescript
import { randomBytes, timingSafeEqual } from 'crypto';

const TOKEN_BYTE_LENGTH = 32;

export function generateCsrfToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
}

export function csrfTokensMatch(
  cookieValue: string | undefined,
  headerValue: string | undefined,
): boolean {
  if (!cookieValue || !headerValue) {
    return false;
  }
  const a = Buffer.from(cookieValue, 'utf8');
  const b = Buffer.from(headerValue, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
```

Create `src/core/csrf/csrf-token.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { csrfTokensMatch, generateCsrfToken } from './helpers/csrf-token';

@Injectable()
export class CsrfTokenService {
  generateToken(): string {
    return generateCsrfToken();
  }

  tokensMatch(
    cookieValue: string | undefined,
    headerValue: string | undefined,
  ): boolean {
    return csrfTokensMatch(cookieValue, headerValue);
  }
}
```

Create `src/core/csrf/constants/csrf.constants.ts`:

```typescript
export const CSRF_TOKEN_HEADER = 'x-csrf-token';
export const CSRF_OPTIONS = 'CSRF_OPTIONS';

/** Reuse health probe paths — CSRF must not block ALB checks. */
export const DEFAULT_CSRF_EXEMPT_PATHS = ['/health', '/health/ready'] as const;

export const DEFAULT_CSRF_OPTIONS = {
  enabled: true,
  cookieName: 'csrf_token',
  headerName: CSRF_TOKEN_HEADER,
  exemptPaths: DEFAULT_CSRF_EXEMPT_PATHS,
} as const;
```

After Task 2 adds `CSRF_TOKEN_COOKIE` to `@/common/constants`, update `DEFAULT_CSRF_OPTIONS.cookieName` to use that constant (single commit in Task 2).

Create barrel files `constants/index.ts`, `types/index.ts`, `helpers/index.ts` exporting the above.

Create `src/core/csrf/types/csrf.types.ts`:

```typescript
export type CsrfModuleOptions = {
  enabled?: boolean;
  cookieName?: string;
  headerName?: string;
  exemptPaths?: readonly string[];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --watchman=false src/core/csrf/csrf-token.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/csrf
git commit -m "feat(csrf): add token generation and constant-time compare"
```

---

### Task 2: Cookie options and `setCsrfCookie` helper

**Files:**
- Modify: `src/common/constants/cookie.constant.ts`
- Modify: `src/common/utils/cookie.utils.ts`
- Create: `src/core/csrf/helpers/set-csrf-cookie.ts`
- Create: `src/core/csrf/helpers/set-csrf-cookie.spec.ts`

**Interfaces:**
- Produces: `CSRF_TOKEN_COOKIE` re-exported from `@/common/constants` (single source of truth in `cookie.constant.ts`)
- Produces: `getCsrfTokenCookieOptions(): CookieSerializeOptions` — **`httpOnly: false`**, `sameSite: 'strict'`, `path: '/'`, no `maxAge` (session cookie) unless options add TTL later
- Produces: `setCsrfCookie(reply, token, cookieName?): void`

- [ ] **Step 1: Write the failing test**

Create `src/core/csrf/helpers/set-csrf-cookie.spec.ts`:

```typescript
import { getCsrfTokenCookieOptions } from '@/common/utils/cookie.utils';

describe('getCsrfTokenCookieOptions', () => {
  it('is readable by JavaScript (not httpOnly)', () => {
    const opts = getCsrfTokenCookieOptions();
    expect(opts.httpOnly).toBe(false);
    expect(opts.sameSite).toBe('strict');
    expect(opts.path).toBe('/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --watchman=false src/core/csrf/helpers/set-csrf-cookie.spec.ts`
Expected: FAIL — `getCsrfTokenCookieOptions` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/common/constants/cookie.constant.ts`:

```typescript
export const CSRF_TOKEN_COOKIE = 'csrf_token';
```

Add to `src/common/utils/cookie.utils.ts`:

```typescript
export const getCsrfTokenCookieOptions = (): CookieSerializeOptions => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
});
```

Create `src/core/csrf/helpers/set-csrf-cookie.ts`:

```typescript
import { FastifyReply } from 'fastify';
import { CSRF_TOKEN_COOKIE } from '@/common/constants';
import { getCsrfTokenCookieOptions } from '@/common/utils';

export function setCsrfCookie(
  reply: FastifyReply,
  token: string,
  cookieName: string = CSRF_TOKEN_COOKIE,
): void {
  reply.setCookie(cookieName, token, getCsrfTokenCookieOptions());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --watchman=false src/core/csrf/helpers/set-csrf-cookie.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/common/constants/cookie.constant.ts src/common/utils/cookie.utils.ts src/core/csrf/helpers/set-csrf-cookie.ts src/core/csrf/helpers/set-csrf-cookie.spec.ts
git commit -m "feat(csrf): add readable csrf_token cookie options"
```

---

### Task 3: Request classification helpers (`shouldEnforceCsrf`)

**Files:**
- Create: `src/core/csrf/helpers/should-enforce-csrf.ts`
- Create: `src/core/csrf/helpers/should-enforce-csrf.spec.ts`
- Create: `src/core/csrf/helpers/is-csrf-exempt-path.ts`
- Create: `src/core/csrf/helpers/is-csrf-exempt-path.spec.ts`

**Interfaces:**
- Consumes: `ACCESS_TOKEN_COOKIE`, `SESSION_ID_COOKIE` from `@/common/constants`
- Produces: `isCsrfExemptPath(url: string, exemptPaths: readonly string[]): boolean`
- Produces: `shouldEnforceCsrf(req: { method?: string; headers?: Record<string, unknown>; cookies?: Record<string, string> }): boolean`

**Rules encoded in `shouldEnforceCsrf`:**

1. Method must be one of **`POST`**, **`PUT`**, **`PATCH`**, **`DELETE`** (case-insensitive).
2. If **`Authorization`** header starts with **`Bearer `** (case-insensitive key), **skip** (mobile / API client).
3. If neither **`access_token`** nor **`session_id`** cookie is present, **skip** (no cookie session to abuse).
4. Otherwise **enforce**.

- [ ] **Step 1: Write the failing tests**

Create `src/core/csrf/helpers/is-csrf-exempt-path.spec.ts`:

```typescript
import { isCsrfExemptPath } from './is-csrf-exempt-path';

describe('isCsrfExemptPath', () => {
  it('matches health paths without query string', () => {
    expect(isCsrfExemptPath('/health?x=1', ['/health'])).toBe(true);
    expect(isCsrfExemptPath('/health/ready', ['/health/ready'])).toBe(true);
    expect(isCsrfExemptPath('/api', ['/health'])).toBe(false);
  });
});
```

Create `src/core/csrf/helpers/should-enforce-csrf.spec.ts`:

```typescript
import {
  ACCESS_TOKEN_COOKIE,
  SESSION_ID_COOKIE,
} from '@/common/constants';
import { shouldEnforceCsrf } from './should-enforce-csrf';

describe('shouldEnforceCsrf', () => {
  it('skips GET even with cookies', () => {
    expect(
      shouldEnforceCsrf({
        method: 'GET',
        cookies: { [ACCESS_TOKEN_COOKIE]: 'jwt' },
      }),
    ).toBe(false);
  });

  it('skips POST with Bearer auth', () => {
    expect(
      shouldEnforceCsrf({
        method: 'POST',
        headers: { authorization: 'Bearer abc' },
        cookies: { [ACCESS_TOKEN_COOKIE]: 'jwt' },
      }),
    ).toBe(false);
  });

  it('skips POST without session cookies', () => {
    expect(shouldEnforceCsrf({ method: 'POST', cookies: {} })).toBe(false);
  });

  it('enforces POST with access_token cookie and no Bearer', () => {
    expect(
      shouldEnforceCsrf({
        method: 'POST',
        cookies: { [ACCESS_TOKEN_COOKIE]: 'jwt' },
      }),
    ).toBe(true);
  });

  it('enforces refresh POST with session_id cookie only', () => {
    expect(
      shouldEnforceCsrf({
        method: 'POST',
        cookies: { [SESSION_ID_COOKIE]: 'uuid' },
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --watchman=false src/core/csrf/helpers/should-enforce-csrf.spec.ts src/core/csrf/helpers/is-csrf-exempt-path.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/csrf/helpers/is-csrf-exempt-path.ts` (reuse normalize pattern from `src/core/overload/is-pressure-exempt-path.ts` — copy `normalizeRequestPath` locally to avoid coupling overload → csrf):

```typescript
export function normalizeRequestPath(url: string): string {
  const raw = url.split('?')[0] ?? url;
  if (raw.length > 1 && raw.endsWith('/')) {
    return raw.slice(0, -1);
  }
  return raw;
}

export function isCsrfExemptPath(
  url: string,
  exemptPaths: readonly string[],
): boolean {
  const path = normalizeRequestPath(url);
  return exemptPaths.includes(path);
}
```

Create `src/core/csrf/helpers/should-enforce-csrf.ts`:

```typescript
import {
  ACCESS_TOKEN_COOKIE,
  SESSION_ID_COOKIE,
} from '@/common/constants';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const direct = headers[name];
  if (typeof direct === 'string') {
    return direct;
  }
  const lower = headers[name.toLowerCase()];
  return typeof lower === 'string' ? lower : undefined;
}

function hasBearerAuth(headers: Record<string, unknown> | undefined): boolean {
  const auth = headerValue(headers, 'authorization');
  return typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ');
}

function hasSessionCookies(cookies: Record<string, string> | undefined): boolean {
  if (!cookies) {
    return false;
  }
  return Boolean(cookies[ACCESS_TOKEN_COOKIE] || cookies[SESSION_ID_COOKIE]);
}

export function shouldEnforceCsrf(req: {
  method?: string;
  headers?: Record<string, unknown>;
  cookies?: Record<string, string>;
}): boolean {
  const method = (req.method ?? 'GET').toUpperCase();
  if (!UNSAFE_METHODS.has(method)) {
    return false;
  }
  if (hasBearerAuth(req.headers)) {
    return false;
  }
  if (!hasSessionCookies(req.cookies)) {
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test --watchman=false src/core/csrf/helpers/should-enforce-csrf.spec.ts src/core/csrf/helpers/is-csrf-exempt-path.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/csrf/helpers/should-enforce-csrf.ts src/core/csrf/helpers/should-enforce-csrf.spec.ts src/core/csrf/helpers/is-csrf-exempt-path.ts src/core/csrf/helpers/is-csrf-exempt-path.spec.ts
git commit -m "feat(csrf): classify requests that require CSRF validation"
```

---

### Task 4: `CsrfForbiddenError` and middleware

**Files:**
- Create: `src/core/csrf/errors/csrf-forbidden.error.ts`
- Create: `src/core/csrf/errors/index.ts`
- Create: `src/core/csrf/middleware/csrf.middleware.ts`
- Create: `src/core/csrf/middleware/csrf.middleware.spec.ts`

**Interfaces:**
- Produces: `CsrfForbiddenError extends ForbiddenException` with body `{ statusCode: 403, message: 'CSRF token invalid or missing', error: 'Forbidden', code: 'CSRF_VALIDATION_FAILED' }`
- Consumes: `CsrfTokenService`, `CSRF_OPTIONS`, `shouldEnforceCsrf`, `isCsrfExemptPath`

- [ ] **Step 1: Write the failing middleware test**

Create `src/core/csrf/middleware/csrf.middleware.spec.ts`:

```typescript
import { CsrfMiddleware } from './csrf.middleware';
import { CsrfTokenService } from '../csrf-token.service';
import { CSRF_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE } from '@/common/constants';
import { CsrfForbiddenError } from '../errors/csrf-forbidden.error';

describe('CsrfMiddleware', () => {
  const tokenService = new CsrfTokenService();
  const middleware = new CsrfMiddleware(tokenService, {
    enabled: true,
    cookieName: CSRF_TOKEN_COOKIE,
    headerName: 'x-csrf-token',
    exemptPaths: ['/health'],
  });

  it('passes through GET requests', () => {
    const next = jest.fn();
    middleware.use({ method: 'GET', url: '/any' } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('passes exempt paths', () => {
    const next = jest.fn();
    middleware.use(
      {
        method: 'POST',
        url: '/health',
        cookies: { [ACCESS_TOKEN_COOKIE]: 'x' },
      } as never,
      {} as never,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects POST with cookie session but no matching header', () => {
    const next = jest.fn();
    middleware.use(
      {
        method: 'POST',
        url: '/auth/logout',
        cookies: {
          [ACCESS_TOKEN_COOKIE]: 'jwt',
          [CSRF_TOKEN_COOKIE]: 'abc',
        },
        headers: {},
      } as never,
      {} as never,
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(CsrfForbiddenError));
  });

  it('passes POST when cookie and header match', () => {
    const token = tokenService.generateToken();
    const next = jest.fn();
    middleware.use(
      {
        method: 'POST',
        url: '/auth/logout',
        cookies: {
          [ACCESS_TOKEN_COOKIE]: 'jwt',
          [CSRF_TOKEN_COOKIE]: token,
        },
        headers: { 'x-csrf-token': token },
      } as never,
      {} as never,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --watchman=false src/core/csrf/middleware/csrf.middleware.spec.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `src/core/csrf/errors/csrf-forbidden.error.ts`:

```typescript
import { ForbiddenException } from '@nestjs/common';

export class CsrfForbiddenError extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      message: 'CSRF token invalid or missing',
      error: 'Forbidden',
      code: 'CSRF_VALIDATION_FAILED',
    });
  }
}
```

Create `src/core/csrf/middleware/csrf.middleware.ts`:

```typescript
import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { CSRF_OPTIONS, DEFAULT_CSRF_OPTIONS } from '../constants/csrf.constants';
import { CsrfForbiddenError } from '../errors/csrf-forbidden.error';
import { CsrfTokenService } from '../csrf-token.service';
import { isCsrfExemptPath } from '../helpers/is-csrf-exempt-path';
import { shouldEnforceCsrf } from '../helpers/should-enforce-csrf';
import { CsrfModuleOptions } from '../types/csrf.types';

type CsrfRequest = FastifyRequest & {
  cookies?: Record<string, string>;
};

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly options: Required<CsrfModuleOptions>;

  constructor(
    private readonly csrfTokenService: CsrfTokenService,
    @Optional() @Inject(CSRF_OPTIONS) options?: CsrfModuleOptions,
  ) {
    this.options = {
      enabled: options?.enabled ?? DEFAULT_CSRF_OPTIONS.enabled,
      cookieName: options?.cookieName ?? DEFAULT_CSRF_OPTIONS.cookieName,
      headerName: options?.headerName ?? DEFAULT_CSRF_OPTIONS.headerName,
      exemptPaths:
        options?.exemptPaths ?? DEFAULT_CSRF_OPTIONS.exemptPaths,
    };
  }

  use(req: CsrfRequest, _res: FastifyReply, next: (err?: Error) => void): void {
    if (!this.options.enabled) {
      next();
      return;
    }

    const url = typeof req.url === 'string' ? req.url : '';
    if (isCsrfExemptPath(url, this.options.exemptPaths)) {
      next();
      return;
    }

    if (
      !shouldEnforceCsrf({
        method: req.method,
        headers: req.headers as Record<string, unknown>,
        cookies: req.cookies,
      })
    ) {
      next();
      return;
    }

    const cookieToken = req.cookies?.[this.options.cookieName];
    const headerToken = this.readHeader(req, this.options.headerName);

    if (!this.csrfTokenService.tokensMatch(cookieToken, headerToken)) {
      next(new CsrfForbiddenError());
      return;
    }

    next();
  }

  private readHeader(req: CsrfRequest, name: string): string | undefined {
    const headers = req.headers as Record<string, unknown>;
    const value = headers[name] ?? headers[name.toLowerCase()];
    return typeof value === 'string' ? value : undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --watchman=false src/core/csrf/middleware/csrf.middleware.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/csrf/errors src/core/csrf/middleware
git commit -m "feat(csrf): enforce double-submit cookie in middleware"
```

---

### Task 5: `CsrfModule` and `AppModule` wiring

**Files:**
- Create: `src/core/csrf/csrf.module.ts`
- Create: `src/core/csrf/index.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `CsrfModule.forRoot(options?: CsrfModuleOptions)` — global module exporting `CsrfMiddleware`, `CsrfTokenService`, `CSRF_OPTIONS`
- Consumes: `ConfigService` for `CSRF_ENABLED` (optional env)

- [ ] **Step 1: Write the failing smoke test (module compiles)**

Create `src/core/csrf/csrf.module.spec.ts`:

```typescript
import { CsrfModule } from './csrf.module';
import { CsrfMiddleware } from './middleware/csrf.middleware';
import { CsrfTokenService } from './csrf-token.service';

describe('CsrfModule', () => {
  it('forRoot provides middleware and token service', () => {
    const dynamic = CsrfModule.forRoot({ enabled: true });
    const providers = dynamic.providers ?? [];
    const tokens = providers.map((p) =>
      typeof p === 'object' && p !== null && 'provide' in p
        ? (p as { provide: unknown }).provide
        : p,
    );
    expect(tokens).toContain(CsrfMiddleware);
    expect(tokens).toContain(CsrfTokenService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --watchman=false src/core/csrf/csrf.module.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement module and wire AppModule**

Create `src/core/csrf/csrf.module.ts` (mirror `RequestDeadlineModule.forRoot` structure):

```typescript
import { DynamicModule, Global, Module } from '@nestjs/common';
import {
  CSRF_OPTIONS,
  DEFAULT_CSRF_OPTIONS,
} from './constants/csrf.constants';
import { CsrfMiddleware } from './middleware/csrf.middleware';
import { CsrfTokenService } from './csrf-token.service';
import { CsrfModuleOptions } from './types/csrf.types';

function mergeOptions(
  options: CsrfModuleOptions = {},
): Required<CsrfModuleOptions> {
  return {
    enabled: options.enabled ?? DEFAULT_CSRF_OPTIONS.enabled,
    cookieName: options.cookieName ?? DEFAULT_CSRF_OPTIONS.cookieName,
    headerName: options.headerName ?? DEFAULT_CSRF_OPTIONS.headerName,
    exemptPaths: options.exemptPaths ?? DEFAULT_CSRF_OPTIONS.exemptPaths,
  };
}

@Global()
@Module({})
export class CsrfModule {
  static forRoot(options: CsrfModuleOptions = {}): DynamicModule {
    const merged = mergeOptions(options);
    return {
      module: CsrfModule,
      providers: [
        { provide: CSRF_OPTIONS, useValue: merged },
        CsrfTokenService,
        CsrfMiddleware,
      ],
      exports: [CSRF_OPTIONS, CsrfTokenService, CsrfMiddleware],
    };
  }

  static forRootAsync(options: {
    inject?: unknown[];
    useFactory: (...args: unknown[]) => CsrfModuleOptions | Promise<CsrfModuleOptions>;
  }): DynamicModule {
    return {
      module: CsrfModule,
      providers: [
        {
          provide: CSRF_OPTIONS,
          useFactory: async (...args: unknown[]) =>
            mergeOptions(await options.useFactory(...args)),
          inject: (options.inject ?? []) as never[],
        },
        CsrfTokenService,
        CsrfMiddleware,
      ],
      exports: [CSRF_OPTIONS, CsrfTokenService, CsrfMiddleware],
    };
  }
}
```

Create `src/core/csrf/index.ts` exporting public API.

Modify `src/app.module.ts`:

1. Import `CsrfModule` from `./core/csrf`.
2. Add to `imports`:

```typescript
CsrfModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    enabled: configService.get<string>('CSRF_ENABLED', 'true') !== 'false',
    exemptPaths: parseCsvPaths(
      configService.get<string>('CSRF_EXEMPT_PATHS'),
      DEFAULT_CSRF_EXEMPT_PATHS,
    ),
  }),
}),
```

Implement `parseCsvPaths` in `src/core/csrf/helpers/parse-csv-paths.ts` (with unit test) — splits comma-separated paths, trims, falls back to defaults when unset.

3. In `configure(consumer)`, apply **`CsrfMiddleware`** immediately **after** `GuestIdMiddleware` (cookies available):

```typescript
consumer
  .apply(
    LoggerMiddleware,
    GuestIdMiddleware,
    CsrfMiddleware,
    InboundBulkheadMiddleware,
    RequestDeadlineMiddleware,
  )
  .forRoutes({ path: '*', method: RequestMethod.ALL });
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --watchman=false src/core/csrf/csrf.module.spec.ts`
Expected: PASS

Run: `pnpm test --watchman=false`
Expected: existing suite still passes.

- [ ] **Step 5: Commit**

```bash
git add src/core/csrf src/app.module.ts
git commit -m "feat(csrf): register global CSRF middleware"
```

---

### Task 6: `GET /auth/csrf` bootstrap and login/refresh rotation

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Create: `src/auth/auth-csrf.controller.spec.ts` (unit-style with mocked services)

**Interfaces:**
- Consumes: `CsrfTokenService`, `setCsrfCookie`
- Produces: **`GET /auth/csrf`** — `@Public()`, returns `{ csrfToken: string }`, sets `csrf_token` cookie
- Produces: login and refresh handlers call `setCsrfCookie` with a freshly generated token on success

- [ ] **Step 1: Write the failing test**

Create `src/auth/auth-csrf.controller.spec.ts` testing a small extracted handler or the controller method with mocks:

```typescript
import { AuthController } from './auth.controller';
import { CsrfTokenService } from '@/core/csrf/csrf-token.service';

describe('AuthController CSRF', () => {
  it('getCsrf sets cookie and returns token', async () => {
    const csrfTokenService = new CsrfTokenService();
    const res = { setCookie: jest.fn() };
    const controller = new AuthController(
      {} as never,
      { get: jest.fn() } as never,
      csrfTokenService,
    );
    const body = await controller.getCsrf(res as never);
    expect(body.csrfToken).toEqual(expect.any(String));
    expect(res.setCookie).toHaveBeenCalled();
  });
});
```

Adjust constructor injection: add `CsrfTokenService` to `AuthController` and export `getCsrf` method.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --watchman=false src/auth/auth-csrf.controller.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement controller changes**

In `src/auth/auth.controller.ts`:

```typescript
import { Get } from '@nestjs/common';
import { CsrfTokenService } from '@/core/csrf/csrf-token.service';
import { setCsrfCookie } from '@/core/csrf/helpers/set-csrf-cookie';

// constructor(..., private readonly csrfTokenService: CsrfTokenService) {}

@Public()
@Get('csrf')
getCsrf(@Res({ passthrough: true }) res: FastifyReply) {
  const csrfToken = this.csrfTokenService.generateToken();
  setCsrfCookie(res, csrfToken);
  return { csrfToken };
}
```

After successful **`login`** and **`refresh`**, add:

```typescript
const csrfToken = this.csrfTokenService.generateToken();
setCsrfCookie(res, csrfToken);
```

Include `csrfToken` in JSON response bodies for mobile/SPA parity (optional field alongside `accessToken` / `sessionId`).

Register `CsrfTokenService` availability: `AuthModule` imports `CsrfModule` (global) — no extra import if `@Global()` on `CsrfModule`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --watchman=false src/auth/auth-csrf.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth.controller.ts src/auth/auth-csrf.controller.spec.ts
git commit -m "feat(auth): expose CSRF bootstrap and rotate token on session"
```

---

### Task 7: Environment configuration and `.env.example`

**Files:**
- Modify: `src/common/config/env.schema.ts`
- Modify: `.env.example`
- Create: `src/core/csrf/helpers/parse-csv-paths.spec.ts` (if not done in Task 5)

**Interfaces:**
- `CSRF_ENABLED` — optional, default **`true`** when unset (only explicit `'false'` disables)
- `CSRF_EXEMPT_PATHS` — optional comma-separated paths merged with defaults (not replaced entirely unless you document replacement — implement **append** to defaults for safety)

- [ ] **Step 1: Document env keys**

Add to `env.schema.ts`:

```typescript
CSRF_ENABLED: { required: false },
CSRF_EXEMPT_PATHS: { required: false },
```

Add to `.env.example`:

```bash
# CSRF (double-submit cookie for browser sessions)
# Set CSRF_ENABLED=false only for local experiments — never in production cookie mode.
CSRF_ENABLED=true
# CSRF_EXEMPT_PATHS=/webhooks/stripe
```

- [ ] **Step 2: Verify boot**

Run: `pnpm test --watchman=false src/common/config/validate-env.spec.ts`
Expected: PASS (no new required keys)

- [ ] **Step 3: Commit**

```bash
git add src/common/config/env.schema.ts .env.example
git commit -m "docs(config): document CSRF environment variables"
```

---

### Task 8: HTTP integration spec (Fastify inject)

**Files:**
- Create: `src/core/csrf/csrf.http.spec.ts`

**Interfaces:**
- End-to-end wiring: `@fastify/cookie`, `CsrfMiddleware`, minimal `@Controller` POST route, `@Public()`

- [ ] **Step 1: Write integration spec**

Create `src/core/csrf/csrf.http.spec.ts` (pattern from `src/core/compression/response-compression.http.spec.ts`):

```typescript
import { Controller, Module, Post } from '@nestjs/common';
import { Public } from '@/common/decorators';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import { ACCESS_TOKEN_COOKIE, CSRF_TOKEN_COOKIE } from '@/common/constants';
import { CsrfModule } from './csrf.module';

@Controller('probe')
class ProbeController {
  @Public()
  @Post('mutate')
  mutate() {
    return { ok: true };
  }
}

@Module({
  imports: [CsrfModule.forRoot({ enabled: true })],
  controllers: [ProbeController],
})
class ProbeModule {}

describe('CSRF (HTTP)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();

    const adapter = new FastifyAdapter();
    await adapter.register(fastifyCookie as never, { secret: 'test-secret' });

    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    app.useCsrfMiddleware(); // see Step 3 — or apply via NestModule configure in ProbeModule
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 when session cookie present without CSRF header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/probe/mutate',
      cookies: { [ACCESS_TOKEN_COOKIE]: 'fake-jwt' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
  });

  it('returns 200 when cookie and header match', async () => {
    const token = 'test-csrf-token-value12';
    const res = await app.inject({
      method: 'POST',
      url: '/probe/mutate',
      headers: { 'x-csrf-token': token },
      cookies: {
        [ACCESS_TOKEN_COOKIE]: 'fake-jwt',
        [CSRF_TOKEN_COOKIE]: token,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Make ProbeModule implement `NestModule` and apply `CsrfMiddleware` in `configure()`** (replace placeholder `app.useCsrfMiddleware()` from the sketch).

- [ ] **Step 3: Run integration test**

Run: `pnpm test --watchman=false src/core/csrf/csrf.http.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/csrf/csrf.http.spec.ts
git commit -m "test(csrf): add HTTP double-submit integration coverage"
```

---

### Task 9: Feature documentation

**Files:**
- Create: `docs/features/csrf.feature.md`
- Modify: `docs/features/features.md` (CSRF row → **Done** with link)
- Modify: `docs/features/auth.feature.md` (SPA flow section)

- [ ] **Step 1: Write `docs/features/csrf.feature.md`**

Include:

- Threat model (cookie-authenticated browser vs Bearer mobile)
- Double-submit flow diagram (SPA calls `GET /auth/csrf` → stores token → sends `X-CSRF-Token` on POST/PUT/PATCH/DELETE)
- Login/refresh rotation behavior
- GraphQL: single `POST /graphql` covered by middleware
- Env toggles and exempt paths
- Example `fetch`:

```typescript
const { csrfToken } = await fetch('/auth/csrf', { credentials: 'include' }).then((r) => r.json());
await fetch('/auth/logout', {
  method: 'POST',
  credentials: 'include',
  headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
});
```

- [ ] **Step 2: Update feature matrix**

In `docs/features/features.md`, change CSRF row to **Done** linking to `csrf.feature.md`.

- [ ] **Step 3: Update auth feature doc**

Add subsection under **Token transport — web** describing CSRF header requirement for mutating calls after login.

- [ ] **Step 4: Commit**

```bash
git add docs/features/csrf.feature.md docs/features/features.md docs/features/auth.feature.md
git commit -m "docs: document cookie SPA CSRF protection"
```

---

## Self-review (spec coverage)

| Requirement | Task |
| ----------- | ---- |
| Double-submit cookie for cookie-based sessions | Tasks 1–4 |
| Skip Bearer-only clients | Task 3 |
| Skip safe methods | Task 3 |
| GraphQL POST once per request | Task 4 (middleware, not guard) |
| SPA bootstrap endpoint | Task 6 |
| Rotate on login/refresh | Task 6 |
| Health probes exempt | Tasks 1, 3, 4 |
| Config disable for local dev | Tasks 5, 7 |
| Tests + docs | Tasks 8, 9 |

**Placeholder scan:** No TBD steps; each task includes concrete code and commands.

**Type consistency:** Cookie name `csrf_token` / header `x-csrf-token` used consistently via constants and `CSRF_OPTIONS`.

---

## SPA integration checklist (for frontend teams)

1. On app boot (before any mutating call), `GET /auth/csrf` with `credentials: 'include'`.
2. Keep `csrfToken` in memory; optionally mirror from `document.cookie` (`csrf_token` is not httpOnly).
3. On every **POST/PUT/PATCH/DELETE** with `credentials: 'include'`, set header **`X-CSRF-Token`** to the current token.
4. After **login** or **refresh**, update in-memory token from response JSON (`csrfToken` field).
5. Native apps using **Bearer** only: do not send session cookies; CSRF is not enforced.
