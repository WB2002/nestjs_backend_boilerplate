import { UserRole } from '@/auth/constants';
import { FeatureFlagPermission } from './constants';
import {
  permissionsForRole,
  roleHasPermission,
} from './feature-flag.permissions';

describe('feature-flag.permissions', () => {
  it('grants all flag permissions to admin', () => {
    expect(permissionsForRole(UserRole.ADMIN)).toEqual([
      FeatureFlagPermission.READ,
      FeatureFlagPermission.CREATE,
      FeatureFlagPermission.UPDATE,
      FeatureFlagPermission.DELETE,
    ]);
    expect(
      roleHasPermission(UserRole.ADMIN, FeatureFlagPermission.DELETE),
    ).toBe(true);
  });

  it('grants no flag permissions to regular users', () => {
    expect(permissionsForRole(UserRole.USER)).toEqual([]);
    expect(roleHasPermission(UserRole.USER, FeatureFlagPermission.READ)).toBe(
      false,
    );
    expect(permissionsForRole(undefined)).toEqual([]);
  });
});
