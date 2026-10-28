# WebSocket (Socket.IO)

## Overview

Real-time messaging uses **Socket.IO** on the same HTTP port as Fastify. Core security lives under `src/core/websocket/`; the sample gateway is `ExampleRealtimeGateway` (`namespace: /realtime`) in `src/example/`.

## Authentication

Same access token as REST (RS256 JWT + Redis JTI revocation via `AccessTokenAuthenticator`).

| Client | How to authenticate |
| ------ | ------------------- |
| Browser (cookies) | `access_token` httpOnly cookie on the handshake |
| Mobile / API | `Authorization: Bearer <token>` on the handshake |
| Mobile (Socket.IO client) | `auth: { token: '<access_token>' }` |

**Query-string tokens** (`?access_token=`) are **disabled** unless `WEBSOCKET_ALLOW_QUERY_TOKEN=true` (dev only).

Authentication runs on **connection** (`handleConnection` → `WsHandshakeService`). Unauthenticated clients are disconnected immediately. Message handlers use `WsAuthenticatedGuard` (user must already be on `socket.data`). Handlers/gateways marked `@Public()` skip message auth checks.

## Authorization

Use `@WsRequireRoles(UserRole.ADMIN)` with `@UseGuards(WsRolesGuard)` on `@SubscribeMessage` handlers. Any listed role satisfies the check.

## Room safety

Do not trust client-supplied room names. The example only allows joining `user:{authenticatedUserId}`.

## Multi-VM

When `WEBSOCKET_REDIS_ADAPTER` is true (default in production), Socket.IO uses the Redis adapter so emits reach all app instances.

## Limits

- **Connections per user:** enforced at **connect** time via `WEBSOCKET_MAX_CONNECTIONS_PER_USER`. Redis mode uses a set plus per-socket alive keys (`WEBSOCKET_CONNECTION_KEY_TTL_SEC`) and prunes stale members before each connect.
- **Messages per minute:** `WEBSOCKET_MESSAGES_PER_MINUTE` per user.
- **Payload size:** `WEBSOCKET_MAX_INBOUND_BUFFER_BYTES` on the Socket.IO server.

## Client example

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/realtime', {
  auth: { token: accessTokenFromLogin },
  withCredentials: true,
});

socket.emit('join', { room: `user:${userId}` });
socket.on('message', (payload) => console.log(payload));
```

## Enabling / disabling

Set `WEBSOCKET_ENABLED=false` to omit `ExampleRealtimeModule` (no `/realtime` gateway). Custom Socket.IO adapter setup in `main.ts` is also skipped when disabled.

## Shutdown

`WebSocketShutdownService` disconnects clients during graceful shutdown before `app.close()`.
