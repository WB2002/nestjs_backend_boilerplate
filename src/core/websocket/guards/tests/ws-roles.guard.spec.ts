import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@/auth/constants';
import { WS_ROLES_KEY } from '../../constants/ws-roles.constants';
import { AuthenticatedSocket } from '../../types/authenticated-socket.types';
import { WsRolesGuard } from '../ws-roles.guard';

describe('WsRolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const guard = new WsRolesGuard(reflector);

  const contextWithRole = (role: string | undefined): ExecutionContext => {
    const client = {
      // eslint-disable-next-line id-denylist -- Socket.IO API
      data: { user: role ? { role } : undefined },
    } as AuthenticatedSocket;
    return {
      switchToWs: () => ({ getClient: () => client }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows when no roles required', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    expect(guard.canActivate(contextWithRole(UserRole.USER))).toBe(true);
  });

  it('allows admin for admin-only handler', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key) =>
      key === WS_ROLES_KEY ? [UserRole.ADMIN] : undefined,
    );
    expect(guard.canActivate(contextWithRole(UserRole.ADMIN))).toBe(true);
  });

  it('denies user for admin-only handler', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key) =>
      key === WS_ROLES_KEY ? [UserRole.ADMIN] : undefined,
    );
    expect(() => guard.canActivate(contextWithRole(UserRole.USER))).toThrow(
      ForbiddenException,
    );
  });
});
