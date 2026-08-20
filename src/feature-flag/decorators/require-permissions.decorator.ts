import { SetMetadata } from '@nestjs/common';
import {
  FEATURE_FLAG_PERMISSIONS_KEY,
  FeatureFlagPermission,
} from '../constants';

export const RequirePermissions = (
  ...permissions: FeatureFlagPermission[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(FEATURE_FLAG_PERMISSIONS_KEY, permissions);
