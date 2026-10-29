import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@/auth/constants';
import { WS_ROLES_KEY } from '../constants/ws-roles.constants';
import { AuthenticatedSocket } from '../types/authenticated-socket.types';

@Injectable()
export class WsRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(
      WS_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const role = client.data.user?.role;
    const isAllowed = role !== undefined && required.some((r) => r === role);
    if (!isAllowed) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
