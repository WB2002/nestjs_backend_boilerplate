import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@/auth/constants';
import { WS_ROLES_KEY } from '../constants/ws-roles.constants';

export const WsRequireRoles = (...roles: UserRole[]) =>
  SetMetadata(WS_ROLES_KEY, roles);
