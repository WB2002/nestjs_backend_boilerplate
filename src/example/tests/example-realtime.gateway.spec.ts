jest.mock('@/auth/auth.service', () => ({
  AuthService: jest.fn(),
}));

import { ForbiddenException } from '@nestjs/common';
import { WsHandshakeService } from '@/core/websocket/auth/ws-handshake.service';
import { WsConnectionLimiterService } from '@/core/websocket/rate-limit/ws-connection-limiter.service';
import { ExampleRealtimeGateway } from '../example-realtime.gateway';
import { WebSocketShutdownService } from '@/core/websocket/websocket-shutdown.service';
import { AuthenticatedSocket } from '@/core/websocket/types/authenticated-socket.types';

describe('ExampleRealtimeGateway', () => {
  const connectionLimiter = {
    releaseConnection: jest.fn(),
  } as unknown as WsConnectionLimiterService;
  const webSocketShutdown = {
    registerServer: jest.fn(),
  } as unknown as WebSocketShutdownService;

  const handshake = {
    acceptConnection: jest.fn(),
  } as unknown as WsHandshakeService;

  const gateway = new ExampleRealtimeGateway(
    handshake,
    connectionLimiter,
    webSocketShutdown,
  );

  const socket = (userId: string): AuthenticatedSocket =>
    ({
      // Socket.IO handshake bag
      // eslint-disable-next-line id-denylist -- Socket.IO API
      data: { user: { id: userId, email: 'a@b.com', jti: 'j', role: 'user' } },
      join: jest.fn(),
    }) as unknown as AuthenticatedSocket;

  it('handleJoin allows own user room only', () => {
    const client = socket('user-1');
    expect(gateway.handleJoin(client, { room: 'user:user-1' })).toEqual({
      ok: true,
      room: 'user:user-1',
    });
    expect(client.join).toHaveBeenCalledWith('user:user-1');
  });

  it('handleJoin rejects foreign room', () => {
    const client = socket('user-1');
    expect(() => gateway.handleJoin(client, { room: 'user:user-2' })).toThrow(
      ForbiddenException,
    );
  });
});
