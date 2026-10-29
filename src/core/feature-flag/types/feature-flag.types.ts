export const FeatureFlagType = {
  BOOLEAN: 'boolean',
  PERCENTAGE: 'percentage',
} as const;

export type FeatureFlagType =
  (typeof FeatureFlagType)[keyof typeof FeatureFlagType];

export const FeatureFlagTargetingAttribute = {
  USER_ID: 'userId',
  ORGANIZATION_ID: 'organizationId',
} as const;

export type FeatureFlagTargetingAttribute =
  (typeof FeatureFlagTargetingAttribute)[keyof typeof FeatureFlagTargetingAttribute];

export interface IFeatureFlagTargeting {
  attribute: FeatureFlagTargetingAttribute;
}

export interface IFeatureFlag {
  key: string;
  enabled: boolean;
  type: FeatureFlagType;
  rolloutPercentage?: number;
  targeting?: IFeatureFlagTargeting;
  environment: string;
  description?: string;
  owner?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface IFeatureFlagContext {
  userId?: string;
  organizationId?: string;
}

export interface IFeatureFlagEvaluationOptions {
  defaultValue?: boolean;
}

export const FeatureFlagEventType = {
  FLAG_UPDATED: 'FLAG_UPDATED',
  FLAG_DELETED: 'FLAG_DELETED',
} as const;

export type FeatureFlagEventType =
  (typeof FeatureFlagEventType)[keyof typeof FeatureFlagEventType];

export interface IFeatureFlagEvent {
  event: FeatureFlagEventType;
  environment: string;
  key: string;
  version: number;
}

export interface IFeatureFlagHealthStatus {
  healthy: boolean;
  stale: boolean;
  redisAvailable: boolean;
  pubSubConnected: boolean;
  flagCount: number;
  lastReconciledAt: string | null;
  lastError: string | null;
}

export interface IFeatureFlagWriteResult {
  flag: IFeatureFlag | null;
  version: number;
}
