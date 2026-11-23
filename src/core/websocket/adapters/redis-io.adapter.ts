import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';
import { AccessTokenAuthenticator } from '@/auth/access-token-authenticator.service';
import { extractAccessToken } from '../auth/extract-access-token';
import { WebSocketConfig } from '../config/websocket-config.types';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    private readonly appContext: INestApplicationContext,
    private readonly pubClient: Redis,
    private readonly subClient: Redis,
    private readonly wsConfig: WebSocketConfig,
  ) {
    super(appContext);
  }

  connectToRedis(): void {
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const authenticator = this.resolveAuthenticator();
    const server = super.createIOServer(port, {
      path: this.wsConfig.path,
      serveClient: false,
      cors: {
        origin: this.wsConfig.corsOrigins,
        credentials: true,
      },
      maxHttpBufferSize: this.wsConfig.maxInboundBufferBytes,
      allowRequest: async (req, callback) => {
        try {
          const url = req.url ?? '';
          const queryIdx = url.indexOf('?');
          const query =
            queryIdx >= 0
              ? Object.fromEntries(new URLSearchParams(url.slice(queryIdx + 1)))
              : undefined;
          const token = extractAccessToken(
            {
              headers: {
                cookie: req.headers.cookie,
                authorization:
                  typeof req.headers.authorization === 'string'
                    ? req.headers.authorization
                    : undefined,
              },
              ...(query ? { query } : {}),
            },
            { allowQueryToken: this.wsConfig.allowQueryToken },
          );
          if (!token) {
            callback('Unauthorized', false);
            return;
          }
          if (authenticator) {
            await authenticator.verifyAccessToken(token);
          }
          callback(null, true);
        } catch {
          callback('Unauthorized', false);
        }
      },
      ...options,
    } as ServerOptions);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  private resolveAuthenticator(): AccessTokenAuthenticator | null {
    try {
      return this.appContext.get(AccessTokenAuthenticator, { strict: false });
    } catch {
      return null;
    }
  }
}
