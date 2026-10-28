import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@/common/constants';
import { AuthenticatedSocket } from '../types/authenticated-socket.types';

@Injectable()
export class WsAuthenticatedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    if (!client.data.user) {
      throw new UnauthorizedException('WebSocket not authenticated');
    }
    return true;
  }
}
