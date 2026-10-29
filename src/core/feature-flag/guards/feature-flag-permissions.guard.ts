import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FEATURE_FLAG_PERMISSIONS_KEY,
  FeatureFlagPermission,
} from '../constants';
import { roleHasPermission } from '../feature-flag.permissions';

@Injectable()
export class FeatureFlagPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<FeatureFlagPermission[]>(
      FEATURE_FLAG_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { role?: string };
    }>();
    const role = request.user?.role;
    const allowed = required.every((permission) =>
      roleHasPermission(role, permission),
    );
    if (!allowed) {
      throw new ForbiddenException('Insufficient feature-flag permissions');
    }
    return true;
  }
}
