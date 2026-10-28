import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AccessTokenAuthenticator } from '@/auth/access-token-authenticator.service';
import { IS_PUBLIC_KEY } from '@/common/constants';
import { extractAccessToken } from '../auth/extract-access-token';
import { parseWebSocketConfig } from '../config/parse-websocket-config';
import { AuthenticatedSocket } from '../types/authenticated-socket.types';

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
    if (isPublic) {
      return true;
    }

    const client = context.switchToWs().getClient<AuthenticatedSocket>();
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

    client.data.user = await this.authenticator.verifyAccessToken(token);
    return true;
  }
}
