import { UserRole } from '@/auth/constants';
import {
  ADMIN_FEATURE_FLAG_PERMISSIONS,
  FeatureFlagPermission,
} from './constants';

export function permissionsForRole(
  role: string | undefined,
): readonly FeatureFlagPermission[] {
  if (role === UserRole.ADMIN) {
    return ADMIN_FEATURE_FLAG_PERMISSIONS;
  }
  return [];
}

export function roleHasPermission(
  role: string | undefined,
  permission: FeatureFlagPermission,
): boolean {
  return permissionsForRole(role).includes(permission);
}
