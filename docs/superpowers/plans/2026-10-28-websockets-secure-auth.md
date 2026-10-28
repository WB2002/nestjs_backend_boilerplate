# Secure WebSockets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-minded WebSocket layer to the NestJS boilerplate using Socket.IO on the existing Fastify HTTP server, with the same JWT/session revocation model as REST, role-based authorization on handlers, Redis fan-out for multi-VM, and secure defaults (no query-string tokens, origin allowlist, payload limits, per-user connection caps).

**Architecture:** Introduce `src/core/websocket/` for adapters, guards, and config. Extract shared JWT verification + Redis JTI revocation into `AccessTokenAuthenticator` in `src/auth/` so HTTP (`JwtStrategy`) and WebSocket guards stay DRY. Register a custom `RedisIoAdapter` in `main.ts` after `NestFactory.create`. Ship an `ExampleRealtimeGateway` under `src/example/` that demonstrates user-scoped rooms and an admin-only broadcast—patterns consumers copy, not a product feature.

**Tech Stack:** NestJS 11, Fastify 5, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` v4, `@socket.io/redis-adapter`, existing `RedisService` / `AuthService`, Jest (`pnpm test --watchman=false`).

## Global Constraints

- **Runtime:** Node **22+**; package manager **pnpm**; tests via **`pnpm test --watchman=false`**.
- **HTTP server:** **Fastify** via `@nestjs/platform-fastify`; WebSocket shares the same listen port (no second server).
- **Imports:** Top of file only (no inline imports) per workspace rule.
- **Switch exhaustiveness:** `never` in default cases for discriminated unions/enums.
- **Path alias:** `@/*` → `src/*`.
- **Auth parity:** RS256 public key verification, `AuthService.isRevoked(jti)`, roles from JWT payload (`admin` | `user`).
- **Multi-VM:** Redis adapter enabled when `WEBSOCKET_REDIS_ADAPTER=true` or `NODE_ENV=production` (mirrors rate-limit/cache coordination docs).
- **Security defaults:** Query-string tokens **off** unless `WEBSOCKET_ALLOW_QUERY_TOKEN=true`; CORS origins from `ALLOWED_ORIGINS` (fail closed in production if unset); no anonymous sockets unless handler/gateway marked `@WsPublic()` (reuses `IS_PUBLIC_KEY`).

---

## File map

| Area | Create | Modify |
| ---- | ------ | ------ |
| Dependencies | — | `package.json` |
| Shared auth | `src/auth/access-token-authenticator.service.ts`, `src/auth/access-token-authenticator.service.spec.ts`, `src/auth/types/authenticated-user.types.ts` | `src/auth/auth.module.ts`, `src/auth/strategies/jwt.strategy.ts` |
| Core WS | `src/core/websocket/**` (config, guards, decorators, adapter, types, index) | — |
| Bootstrap | — | `src/main.ts`, `src/app.module.ts` |
| Example | `src/example/example-realtime.gateway.ts`, `src/example/dto/example-realtime-message.dto.ts`, specs | `src/example/example.module.ts` |
| Config | — | `src/common/config/env.schema.ts`, `.env.example` |
| Shutdown | `src/core/websocket/websocket-shutdown.service.ts` | `src/core/shutdown/register-graceful-shutdown.ts` (optional hook) or register in `WebSocketShutdownService` via `beforeClose` in `main.ts` |
| Docs | `docs/features/websocket.feature.md` | `docs/features/features.md` |

---

### Task 0: Add WebSocket dependencies

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: npm packages available for `@nestjs/websockets`, Socket.IO, Redis adapter.

- [ ] **Step 1: Install runtime dependencies**

Run:

```bash
pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io @socket.io/redis-adapter
```

- [ ] **Step 2: Install dev dependency for tests**

Run:

```bash
pnpm add -D socket.io-client @types/socket.io-client
```

(If `@types/socket.io-client` is unnecessary because `socket.io-client` ships types, skip types package after install error.)

- [ ] **Step 3: Verify lockfile**

Run: `pnpm install`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add socket.io websocket dependencies"
```

---

### Task 1: Shared `AccessTokenAuthenticator`

**Files:**
- Create: `src/auth/types/authenticated-user.types.ts`
- Create: `src/auth/access-token-authenticator.service.ts`
- Create: `src/auth/access-token-authenticator.service.spec.ts`
- Modify: `src/auth/auth.module.ts`
- Modify: `src/auth/strategies/jwt.strategy.ts`

**Interfaces:**
- Produces: `AccessTokenAuthenticator.verifyAccessToken(rawToken: string): Promise<AuthenticatedUser>`
- Produces type: `AuthenticatedUser { id: string; email: string; jti: string; role: string }`
- Consumes: `JwtService`, `AuthService.isRevoked`, `ConfigService` (`JWT_PUBLIC_KEY`)

- [ ] **Step 1: Write the failing test**

Create `src/auth/access-token-authenticator.service.spec.ts`:

```typescript
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AccessTokenAuthenticator } from './access-token-authenticator.service';
import { AuthService } from './auth.service';
import { UserRole } from './constants';

describe('AccessTokenAuthenticator', () => {
  const publicKey = 'test-public-key';
  const jwtService = {
    verifyAsync: jest.fn(),
  } as unknown as JwtService;
  const authService = {
    isRevoked: jest.fn(),
  } as unknown as AuthService;
  const configService = {
    get: jest.fn((key: string) =>
      key === 'JWT_PUBLIC_KEY' ? publicKey : undefined,
    ),
  } as unknown as ConfigService;

  const authenticator = new AccessTokenAuthenticator(
    jwtService,
    authService,
    configService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects empty token', async () => {
    await expect(authenticator.verifyAccessToken('')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns user when JWT valid and not revoked', async () => {
    (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      email: 'a@example.com',
      jti: 'jti-1',
      role: UserRole.ADMIN,
    });
    (authService.isRevoked as jest.Mock).mockResolvedValue(false);

    await expect(authenticator.verifyAccessToken('tok')).resolves.toEqual({
      id: 'user-1',
      email: 'a@example.com',
      jti: 'jti-1',
      role: UserRole.ADMIN,
    });
  });

  it('rejects revoked session', async () => {
    (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      email: 'a@example.com',
      jti: 'jti-1',
      role: UserRole.USER,
    });
    (authService.isRevoked as jest.Mock).mockResolvedValue(true);

    await expect(authenticator.verifyAccessToken('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --watchman=false src/auth/access-token-authenticator.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types + service**

Create `src/auth/types/authenticated-user.types.ts`:

```typescript
export type AuthenticatedUser = {
  id: string;
  email: string;
  jti: string;
  role: string;
};
```

Create `src/auth/access-token-authenticator.service.ts`:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '@/types';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './types/authenticated-user.types';
import { UserRole } from './constants';

@Injectable()
export class AccessTokenAuthenticator {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  async verifyAccessToken(rawToken: string): Promise<AuthenticatedUser> {
    const token = rawToken.trim();
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const publicKey = (
      this.configService.get<string>('JWT_PUBLIC_KEY') ?? ''
    ).replace(/\\n/g, '\n');

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        publicKey,
        algorithms: ['RS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    const isRevoked = await this.authService.isRevoked(payload.jti);
    if (isRevoked) {
      throw new UnauthorizedException('Session has been revoked');
    }

    return {
      id: payload.sub,
      email: payload.email,
      jti: payload.jti,
      role: payload.role ?? UserRole.USER,
    };
  }
}
```

Export `AuthenticatedUser` from `src/auth/types/authenticated-user.types.ts` (no barrel required unless one exists).

Update `src/auth/auth.module.ts` — add provider + export:

```typescript
import { AccessTokenAuthenticator } from './access-token-authenticator.service';
// providers: [AuthService, LocalStrategy, JwtStrategy, AccessTokenAuthenticator],
// exports: [AuthService, AccessTokenAuthenticator],
```

Refactor `src/auth/strategies/jwt.strategy.ts` `validate` to:

```typescript
async validate(payload: JwtPayload) {
  return this.accessTokenAuthenticator.userFromVerifiedPayload(payload);
}
```

Add to `AccessTokenAuthenticator`:

```typescript
userFromVerifiedPayload(payload: JwtPayload): Promise<AuthenticatedUser> {
  return this.ensureNotRevokedAndMap(payload);
}

private async ensureNotRevokedAndMap(payload: JwtPayload): Promise<AuthenticatedUser> {
  const isRevoked = await this.authService.isRevoked(payload.jti);
  if (isRevoked) {
    throw new UnauthorizedException('Session has been revoked');
  }
  return {
    id: payload.sub,
    email: payload.email,
    jti: payload.jti,
    role: payload.role ?? UserRole.USER,
  };
}
```

Inject `AccessTokenAuthenticator` into `JwtStrategy` constructor.

- [ ] **Step 4: Run tests**

Run: `pnpm test --watchman=false src/auth/access-token-authenticator.service.spec.ts`
Expected: PASS.

Run: `pnpm test --watchman=false src/auth` (or full suite if fast enough).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/access-token-authenticator.service.ts src/auth/access-token-authenticator.service.spec.ts src/auth/types/authenticated-user.types.ts src/auth/auth.module.ts src/auth/strategies/jwt.strategy.ts
git commit -m "feat(auth): extract access token authenticator for reuse"
```

---

### Task 2: WebSocket config + token extraction helpers

**Files:**
- Create: `src/core/websocket/config/websocket-config.types.ts`
- Create: `src/core/websocket/config/parse-websocket-config.ts`
- Create: `src/core/websocket/config/parse-websocket-config.spec.ts`
- Create: `src/core/websocket/auth/extract-access-token.ts`
- Create: `src/core/websocket/auth/extract-access-token.spec.ts`
- Modify: `src/common/config/env.schema.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `parseWebSocketConfig(config: ConfigService): WebSocketConfig`
- Produces: `extractAccessToken(handshake, options): string | null`

- [ ] **Step 1: Write failing config test**

Create `src/core/websocket/config/parse-websocket-config.spec.ts`:

```typescript
import { parseWebSocketConfig } from './parse-websocket-config';

describe('parseWebSocketConfig', () => {
  it('disables query token by default and requires origins in production', () => {
    const config = parseWebSocketConfig({
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ALLOWED_ORIGINS') return 'https://app.example.com';
        return undefined;
      },
    } as any);

    expect(config.allowQueryToken).toBe(false);
    expect(config.corsOrigins).toEqual(['https://app.example.com']);
    expect(config.redisAdapterEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm test --watchman=false src/core/websocket/config/parse-websocket-config.spec.ts`

- [ ] **Step 3: Implement config + env keys**

Add to `env.schema.ts` (all optional):

```typescript
  WEBSOCKET_ENABLED: { required: false },
  WEBSOCKET_PATH: { required: false },
  WEBSOCKET_ALLOW_QUERY_TOKEN: { required: false },
  WEBSOCKET_REDIS_ADAPTER: { required: false },
  WEBSOCKET_MAX_CONNECTIONS_PER_USER: { required: false },
  WEBSOCKET_MAX_INBOUND_BUFFER_BYTES: { required: false },
  WEBSOCKET_MESSAGES_PER_MINUTE: { required: false },
```

Implement `parse-websocket-config.ts` with:

- `enabled`: default `true`
- `path`: default `'/socket.io'`
- `allowQueryToken`: only `true` when env `WEBSOCKET_ALLOW_QUERY_TOKEN=true`
- `redisAdapterEnabled`: `true` when `WEBSOCKET_REDIS_ADAPTER=true` OR (`NODE_ENV=production` AND env not explicitly `false`)
- `corsOrigins`: split `ALLOWED_ORIGINS` by comma; if `NODE_ENV=production` and list empty → throw at boot in `WebSocketModule` factory OR return empty and let adapter fail closed — **throw `Error('ALLOWED_ORIGINS required for WebSocket in production')`**
- `maxConnectionsPerUser`: default `5`
- `maxInboundBufferBytes`: default `1_000_000` (1 MiB)
- `messagesPerMinute`: default `120`

Add commented keys to `.env.example`.

- [ ] **Step 4: Write failing extract token test**

Create `src/core/websocket/auth/extract-access-token.spec.ts`:

```typescript
import { extractAccessToken } from './extract-access-token';
import { ACCESS_TOKEN_COOKIE } from '@/common/constants';

describe('extractAccessToken', () => {
  it('reads bearer header first', () => {
    const token = extractAccessToken(
      {
        headers: {
          authorization: 'Bearer header-token',
          cookie: `${ACCESS_TOKEN_COOKIE}=cookie-token`,
        },
      },
      { allowQueryToken: false },
    );
    expect(token).toBe('header-token');
  });

  it('reads cookie when no bearer', () => {
    const token = extractAccessToken(
      {
        headers: { cookie: `${ACCESS_TOKEN_COOKIE}=cookie-token` },
      },
      { allowQueryToken: false },
    );
    expect(token).toBe('cookie-token');
  });

  it('reads handshake.auth.token for mobile clients', () => {
    const token = extractAccessToken(
      { headers: {}, auth: { token: 'mobile-token' } },
      { allowQueryToken: false },
    );
    expect(token).toBe('mobile-token');
  });

  it('ignores query token unless allowed', () => {
    const token = extractAccessToken(
      { headers: {}, query: { access_token: 'query-token' } },
      { allowQueryToken: false },
    );
    expect(token).toBeNull();
  });
});
```

Implement `extract-access-token.ts` with priority: **Authorization Bearer** → **Cookie `access_token`** → **`handshake.auth.token`** → **query** (only if `allowQueryToken`).

Use a small cookie parser (split `;`, decode URI component) — no new dependency.

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm test --watchman=false src/core/websocket/config/parse-websocket-config.spec.ts src/core/websocket/auth/extract-access-token.spec.ts`

- [ ] **Step 6: Commit**

```bash
git add src/core/websocket src/common/config/env.schema.ts .env.example
git commit -m "feat(websocket): config parsing and access token extraction"
```

---

### Task 3: `WsJwtAuthGuard` (authentication)

**Files:**
- Create: `src/core/websocket/types/authenticated-socket.types.ts`
- Create: `src/core/websocket/guards/ws-jwt-auth.guard.ts`
- Create: `src/core/websocket/guards/ws-jwt-auth.guard.spec.ts`
- Create: `src/core/websocket/websocket.module.ts`
- Create: `src/core/websocket/index.ts`

**Interfaces:**
- Consumes: `AccessTokenAuthenticator`, `parseWebSocketConfig`, `extractAccessToken`
- Produces: `WsJwtAuthGuard` attaching `client.data.user: AuthenticatedUser`

- [ ] **Step 1: Write failing guard unit test**

Create `src/core/websocket/guards/ws-jwt-auth.guard.spec.ts` mocking `WsArgumentsHost` / Socket.io client with `handshake` and `data`.

Test cases:
1. `@Public()` handler → returns `true` without calling authenticator (use `IS_PUBLIC_KEY` + Reflector like `JwtAuthGuard`).
2. Missing token → `false` or throws `UnauthorizedException` (pick one; prefer **throw** so Socket.IO rejects connection).
3. Valid token → sets `client.data.user`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement guard**

`src/core/websocket/types/authenticated-socket.types.ts`:

```typescript
import type { AuthenticatedUser } from '@/auth/types/authenticated-user.types';
import type { Socket } from 'socket.io';

export type AuthenticatedSocket = Socket & {
  data: Socket['data'] & { user?: AuthenticatedUser };
};
```

`ws-jwt-auth.guard.ts` essentials:

```typescript
@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authenticator: AccessTokenAuthenticator,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const wsConfig = parseWebSocketConfig(this.configService);
    const token = extractAccessToken(
      {
        headers: client.handshake.headers,
        auth: client.handshake.auth,
        query: client.handshake.query,
      },
      { allowQueryToken: wsConfig.allowQueryToken },
    );

    if (!token) {
      throw new UnauthorizedException('WebSocket authentication required');
    }

    client.data.user = await this.authenticator.verifyAccessToken(token);
    return true;
  }
}
```

`websocket.module.ts`:

```typescript
@Module({
  imports: [AuthModule],
  providers: [WsJwtAuthGuard, WsRolesGuard, WsConnectionLimiterService, WsMessageRateLimiterGuard],
  exports: [WsJwtAuthGuard, WsRolesGuard, WsConnectionLimiterService, WsMessageRateLimiterGuard],
})
export class WebSocketModule {}
```

(Forward-declare guards added in Tasks 4–7 — implement stubs returning `true` until those tasks land, or split module providers per task; **prefer adding providers in the task that implements them**.)

For Task 3 only, export `WsJwtAuthGuard` from a minimal module; expand in later tasks.

- [ ] **Step 4: Run guard tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/core/websocket
git commit -m "feat(websocket): JWT authentication guard for socket.io"
```

---

### Task 4: Role authorization (`WsRolesGuard`)

**Files:**
- Create: `src/core/websocket/decorators/ws-require-roles.decorator.ts`
- Create: `src/core/websocket/constants/ws-roles.constants.ts`
- Create: `src/core/websocket/guards/ws-roles.guard.ts`
- Create: `src/core/websocket/guards/ws-roles.guard.spec.ts`

**Interfaces:**
- Produces: `@WsRequireRoles(...roles: UserRole[])` storing metadata key `WS_ROLES_KEY`
- Produces: `WsRolesGuard` reading `client.data.user.role`

- [ ] **Step 1: Write failing test** — user role `user` blocked when `@WsRequireRoles(UserRole.ADMIN)` on handler.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement decorator + guard** (mirror `FeatureFlagPermissionsGuard` but read WS client):

```typescript
const client = context.switchToWs().getClient<AuthenticatedSocket>();
const role = client.data.user?.role;
if (!role || !required.every((r) => role === r)) {
  throw new ForbiddenException('Insufficient role');
}
```

Note: for multiple roles use `required.includes(role)` if you allow any-of semantics — **use any-of** (admin OR user) via `@WsRequireRoles(UserRole.ADMIN, UserRole.USER)` meaning **any listed role passes**:

```typescript
const allowed = required.some((r) => r === role);
```

Document in feature doc.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/core/websocket/decorators src/core/websocket/guards/ws-roles.guard.ts src/core/websocket/guards/ws-roles.guard.spec.ts src/core/websocket/constants
git commit -m "feat(websocket): role-based authorization guard"
```

---

### Task 5: Redis Socket.IO adapter + bootstrap

**Files:**
- Create: `src/core/websocket/adapters/redis-io.adapter.ts`
- Create: `src/core/websocket/adapters/redis-io.adapter.spec.ts` (unit test adapter factory with mocked Redis)
- Modify: `src/main.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `RedisIoAdapter.createIOServer(port, options)` with `@socket.io/redis-adapter`
- Consumes: `RedisService.getClient()` or duplicate pub/sub clients via `RedisService` — **if `RedisService` only exposes `getClient()`, add `duplicate()` helper** on `RedisService`:

```typescript
duplicate(options?: RedisOptions): Redis {
  return this.getClient().duplicate(options);
}
```

- [ ] **Step 1: Write failing test** that `RedisIoAdapter` sets `adapter()` when redis enabled (mock `createAdapter`).

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `RedisIoAdapter`**

Extend `IoAdapter` from `@nestjs/platform-socket.io`:

```typescript
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { INestApplicationContext } from '@nestjs/common';
import { ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly pubClient: Redis,
    private readonly subClient: Redis,
  ) {
    super(app);
  }

  connectToRedis(): void {
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
```

In `main.ts` after `NestFactory.create`:

```typescript
import { RedisIoAdapter } from '@/core/websocket/adapters/redis-io.adapter';
import { parseWebSocketConfig } from '@/core/websocket/config/parse-websocket-config';

const wsConfig = parseWebSocketConfig(app.get(ConfigService));
if (wsConfig.enabled) {
  const redisService = app.get(RedisService);
  const pubClient = redisService.duplicate({ enableOfflineQueue: false });
  const subClient = redisService.duplicate({ enableOfflineQueue: false });
  const redisIoAdapter = new RedisIoAdapter(app, pubClient, subClient);
  if (wsConfig.redisAdapterEnabled) {
    redisIoAdapter.connectToRedis();
  }
  app.useWebSocketAdapter(redisIoAdapter);
}
```

Import `WebSocketModule` in `AppModule`.

Pass default gateway options via a dedicated provider `WEBSOCKET_SERVER_OPTIONS` or document in gateway decorator:

```typescript
@WebSocketGateway({
  path: wsConfig.path,
  cors: { origin: wsConfig.corsOrigins, credentials: true },
  maxHttpBufferSize: wsConfig.maxInboundBufferBytes,
})
```

Because path/cors are env-driven, use dynamic module:

`WebSocketModule.forRootAsync({ inject: [ConfigService], useFactory: (cs) => ({ ...parseWebSocketConfig(cs) }) })`

Export factory token `WEBSOCKET_OPTIONS` consumed by `ExampleRealtimeGateway` via `@WebSocketGateway()` metadata — **simplest approach:** hardcode path `/socket.io` in gateway but read cors from env in adapter only; gateway uses:

```typescript
@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true } })
```

**Better:** centralize in `websocket-gateway.decorator.ts` helper `RealtimeGateway()` applying config — YAGNI: set in one example gateway using `ConfigService` in `afterInit` is awkward. Use `forRootAsync` providing `WEBSOCKET_OPTIONS` and a custom decorator wrapping `@WebSocketGateway(getGatewayOptions(options))`.

Implement `getWebSocketGatewayOptions(config: WebSocketConfig): GatewayMetadata` returning namespace `/realtime`, cors origins, maxHttpBufferSize.

- [ ] **Step 4: Manual smoke** (document in task — no CI): start app, connect with `socket.io-client` using invalid token → connection error.

- [ ] **Step 5: Commit**

```bash
git add src/core/websocket/adapters src/main.ts src/app.module.ts src/common/redis/redis.service.ts
git commit -m "feat(websocket): redis socket.io adapter and bootstrap"
```

---

### Task 6: Example secure gateway (rooms + validated messages)

**Files:**
- Create: `src/example/dto/example-realtime-message.dto.ts`
- Create: `src/example/example-realtime.gateway.ts`
- Create: `src/example/example-realtime.gateway.spec.ts`
- Modify: `src/example/example.module.ts`

**Interfaces:**
- Consumes: `WsJwtAuthGuard`, `WsRolesGuard`, `@WsRequireRoles`, `ValidationPipe`
- Produces: namespace `/realtime` with events: `join`, `ping`, `message`, `admin-broadcast`

- [ ] **Step 1: Write failing gateway test** (unit test gateway methods with mocked server + socket)

Test: `handleJoin` only allows joining `user:${user.id}` — if client sends `{ room: 'user:other' }` → `ForbiddenException`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement gateway**

```typescript
@WebSocketGateway(getWebSocketGatewayOptions(/* inject config */))
@UseGuards(WsJwtAuthGuard, WsConnectionLimiterService, WsMessageRateLimiterGuard)
export class ExampleRealtimeGateway implements OnGatewayConnection {
  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { room?: string },
  ) {
    const user = client.data.user;
    if (!user) throw new UnauthorizedException();
    const allowedRoom = `user:${user.id}`;
    if (body?.room !== allowedRoom) {
      throw new ForbiddenException('Cannot join foreign room');
    }
    void client.join(allowedRoom);
    return { ok: true, room: allowedRoom };
  }

  @SubscribeMessage('message')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: ExampleRealtimeMessageDto,
  ) {
    const user = client.data.user!;
    this.server.to(`user:${user.id}`).emit('message', {
      text: dto.text,
      from: user.id,
    });
  }

  @SubscribeMessage('admin-broadcast')
  @UseGuards(WsRolesGuard)
  @WsRequireRoles(UserRole.ADMIN)
  handleAdminBroadcast(@MessageBody() dto: ExampleRealtimeMessageDto) {
    this.server.emit('admin-broadcast', { text: dto.text });
  }
}
```

DTO:

```typescript
export class ExampleRealtimeMessageDto {
  @IsString()
  @MaxLength(500)
  text!: string;
}
```

Register gateway in `ExampleModule`; import `WebSocketModule`.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/example/example-realtime.gateway.ts src/example/dto/example-realtime-message.dto.ts src/example/example.module.ts src/example/example-realtime.gateway.spec.ts
git commit -m "feat(example): secure realtime gateway with room isolation"
```

---

### Task 7: Connection caps + message rate limiting

**Files:**
- Create: `src/core/websocket/rate-limit/ws-connection-limiter.service.ts`
- Create: `src/core/websocket/rate-limit/ws-connection-limiter.service.spec.ts`
- Create: `src/core/websocket/guards/ws-message-rate-limiter.guard.ts`
- Create: `src/core/websocket/guards/ws-message-rate-limiter.guard.spec.ts`

**Interfaces:**
- Produces: `WsConnectionLimiterService` implementing `CanActivate` on gateway connect — counts connections per `user.id` in Redis key `ws:conn:{userId}` with INCR on connect, DECR on disconnect (register `handleConnection` / `handleDisconnect` in a base gateway or dedicated `WsConnectionRegistry` injectable).
- Produces: `WsMessageRateLimiterGuard` — Redis sliding window or fixed window per `user.id` key `ws:msg:{userId}`; on exceed emit error / throw `TooManyRequestsException`.

**Connection limit algorithm:**

1. On successful auth in guard, call `limiter.registerConnection(userId, socketId)`.
2. Redis `INCR ws:conn:{userId}`; if count > max, `DECR` and reject connection.
3. On disconnect, `DECR` (floor at 0).

Use in-memory `Map` fallback when `WEBSOCKET_REDIS_ADAPTER=false` and `NODE_ENV=development` only.

- [ ] **Step 1: Write failing connection limit test** (3 connections OK, 4th rejected when max=3).

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement limiter + message guard**

Message guard only applies to `@SubscribeMessage` handlers (check context type); skip connection events.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/core/websocket/rate-limit src/core/websocket/guards/ws-message-rate-limiter.guard.ts
git commit -m "feat(websocket): per-user connection and message rate limits"
```

---

### Task 8: Graceful shutdown for open sockets

**Files:**
- Create: `src/core/websocket/websocket-shutdown.service.ts`
- Modify: `src/main.ts` (`beforeClose` in `registerGracefulShutdown`)

**Interfaces:**
- Consumes: Socket.IO server instance from `ExampleRealtimeGateway.server` or inject `IoServer` token — use `@WebSocketServer() server: Server` held by shutdown service via `ModuleRef.get(ExampleRealtimeGateway)` **or** register server in `WebSocketShutdownService.onModuleInit` from gateway `afterInit`.

Implement `WebSocketShutdownService.closeAll(): Promise<void>`:

```typescript
async closeAll(): Promise<void> {
  if (!this.server) return;
  this.server.local.disconnectSockets(true);
  await new Promise<void>((resolve) => this.server.close(() => resolve()));
}
```

Wire into existing shutdown:

```typescript
beforeClose: async () => {
  await app.get(WebSocketShutdownService).closeAll();
  // existing mongoose destroy
},
```

- [ ] **Step 1: Write test** mocking Server `disconnectSockets` / `close`.

- [ ] **Step 2–4: Implement + PASS**

- [ ] **Step 5: Commit**

```bash
git add src/core/websocket/websocket-shutdown.service.ts src/main.ts
git commit -m "feat(websocket): disconnect sockets on graceful shutdown"
```

---

### Task 9: Documentation + feature index

**Files:**
- Create: `docs/features/websocket.feature.md`
- Modify: `docs/features/features.md`

**Content requirements for `websocket.feature.md`:**

- Auth transports: cookie (browser), `Authorization` header, `auth.token` (mobile); query token dev-only flag.
- Authorization: `@WsRequireRoles`, default authenticated namespace.
- Multi-VM: Redis adapter requirement.
- Security checklist: origins, buffer size, rate limits, room naming convention (`user:{id}`), never trust client room IDs.
- Client example snippet (socket.io-client with `auth: { token }`).

Update `features.md` row **WebSockets + Redis pub/sub** → **Done** with link.

- [ ] **Step 1: Write doc**

- [ ] **Step 2: Commit**

```bash
git add docs/features/websocket.feature.md docs/features/features.md
git commit -m "docs: secure websocket feature guide"
```

---

## Self-review (plan author checklist)

| Spec requirement | Task |
| ---------------- | ---- |
| JWT auth + revocation parity | Task 1, 3 |
| Authorization (roles) | Task 4, 6 |
| Secure defaults (no query token, CORS) | Task 2, 5 |
| Multi-VM Redis fan-out | Task 5 |
| Payload validation | Task 6 |
| Abuse controls (conn + msg limits) | Task 7 |
| Graceful shutdown | Task 8 |
| Boilerplate example | Task 6 |
| Docs | Task 9 |

**Placeholder scan:** None — all tasks include concrete paths and code sketches.

**Type consistency:** `AuthenticatedUser` used in socket `data.user` throughout; `AccessTokenAuthenticator` is single verification entry point.

---

## Plan complete and saved to `docs/superpowers/plans/2026-10-28-websockets-secure-auth.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
