export const FEATURE_FLAG_KEY_PREFIX = 'feature_flags';
export const FEATURE_FLAG_EVENTS_CHANNEL = 'feature_flags:events';
export const DEFAULT_FEATURE_FLAG_RECONCILE_MS = 45_000;
export const DEFAULT_FEATURE_FLAG_ENV = 'development';

export const FEATURE_FLAG_PERMISSIONS_KEY = 'feature_flag_permissions';

export const FeatureFlagPermission = {
  READ: 'flag:read',
  CREATE: 'flag:create',
  UPDATE: 'flag:update',
  DELETE: 'flag:delete',
} as const;

export type FeatureFlagPermission =
  (typeof FeatureFlagPermission)[keyof typeof FeatureFlagPermission];

export const ADMIN_FEATURE_FLAG_PERMISSIONS: readonly FeatureFlagPermission[] =
  [
    FeatureFlagPermission.READ,
    FeatureFlagPermission.CREATE,
    FeatureFlagPermission.UPDATE,
    FeatureFlagPermission.DELETE,
  ];

export const FeatureFlagLogEvent = {
  UPDATED: 'FLAG_UPDATED',
  DELETED: 'FLAG_DELETED',
  RECONCILIATION: 'FLAG_RECONCILIATION',
  REDIS_UNAVAILABLE: 'FLAG_REDIS_UNAVAILABLE',
  PUBSUB_DISCONNECTED: 'FLAG_PUBSUB_DISCONNECTED',
  EVALUATION_DEFAULT_USED: 'FLAG_EVALUATION_DEFAULT_USED',
} as const;
