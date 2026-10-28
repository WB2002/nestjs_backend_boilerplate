import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessTokenAuthenticator } from '@/auth/access-token-authenticator.service';
import { extractAccessToken } from './extract-access-token';
import { parseWebSocketConfig } from '../config/parse-websocket-config';
import { WsConnectionLimiterService } from '../rate-limit/ws-connection-limiter.service';
import { AuthenticatedSocket } from '../types/authenticated-socket.types';

@Injectable()
export class WsHandshakeService {
  constructor(
    private readonly authenticator: AccessTokenAuthenticator,
    private readonly configService: ConfigService,
    private readonly connectionLimiter: WsConnectionLimiterService,
  ) {}

  async acceptConnection(client: AuthenticatedSocket): Promise<void> {
    const wsConfig = parseWebSocketConfig(this.configService);
    const token = extractAccessToken(
      {
        headers: {
          cookie: client.handshake.headers.cookie,
          authorization: client.handshake.headers.authorization,
        },
        auth: client.handshake.auth,
        query: client.handshake.query as Record<string, unknown>,
      },
      { allowQueryToken: wsConfig.allowQueryToken },
    );

    if (!token) {
      throw new UnauthorizedException('WebSocket authentication required');
    }

    const user = await this.authenticator.verifyAccessToken(token);
    client.data.user = user;
    await this.connectionLimiter.registerConnection(user.id, client.id);
    client.data.wsConnectionRegistered = true;
  }
}
