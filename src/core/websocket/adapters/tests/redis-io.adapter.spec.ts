import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AccessTokenAuthenticator } from '@/auth/access-token-authenticator.service';
import type { WebSocketConfig } from '../../config/websocket-config.types';
import { RedisIoAdapter } from '../redis-io.adapter';

describe('RedisIoAdapter', () => {
  const wsConfig: WebSocketConfig = {
    enabled: true,
    path: '/socket.io',
    corsOrigins: ['http://localhost:3000'],
    maxInboundBufferBytes: 65536,
    redisAdapterEnabled: false,
    allowQueryToken: false,
  };

  it('rejects unauthenticated HTTP upgrade handshakes via allowRequest', async () => {
    const verifyAccessToken = jest.fn();
    const app = {
      get: jest.fn().mockReturnValue({
        verifyAccessToken,
      } as unknown as AccessTokenAuthenticator),
      getHttpServer: jest.fn().mockReturnValue({}),
    } as unknown as INestApplicationContext;

    let capturedOpts: Record<string, unknown> | undefined;
    const spy = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockImplementation((_port: number, opts?: Record<string, unknown>) => {
        capturedOpts = opts;
        return { adapter: jest.fn() };
      });

    try {
      const adapter = new RedisIoAdapter(
        app,
        {} as never,
        {} as never,
        wsConfig,
      );
      adapter.createIOServer(0);

      const allowRequest = capturedOpts?.allowRequest as
        | ((
            req: { url?: string; headers: Record<string, string | undefined> },
            cb: (err: string | null | undefined, success: boolean) => void,
          ) => void | Promise<void>)
        | undefined;
      expect(typeof allowRequest).toBe('function');

      const handshakeOutcome = await new Promise<{
        err: unknown;
        isAllowed: boolean;
      }>((resolve) => {
        void allowRequest?.(
          { url: '/socket.io/', headers: {} },
          (err, isAllowed) => resolve({ err, isAllowed }),
        );
      });
      expect(handshakeOutcome.isAllowed).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
