import { createHash } from 'crypto';
import {
  FeatureFlagTargetingAttribute,
  FeatureFlagType,
  IFeatureFlag,
  IFeatureFlagContext,
  IFeatureFlagEvaluationOptions,
} from './types';

export interface IFeatureFlagEvaluationResult {
  enabled: boolean;
  usedDefault: boolean;
  reason:
    | 'missing_flag'
    | 'boolean'
    | 'percentage'
    | 'missing_targeting'
    | 'invalid_percentage'
    | 'disabled';
}

/**
 * Deterministic bucket in [0, 99] for percentage rollouts.
 * Cross-service formula: sha256(`${flagKey}:${targetingValue}`).slice(0, 8) % 100
 */
export function computeRolloutBucket(
  flagKey: string,
  targetingValue: string,
): number {
  const digest = createHash('sha256')
    .update(`${flagKey}:${targetingValue}`)
    .digest('hex');
  return parseInt(digest.slice(0, 8), 16) % 100;
}

function resolveTargetingValue(
  flag: IFeatureFlag,
  context: IFeatureFlagContext,
): string | undefined {
  const attribute =
    flag.targeting?.attribute ?? FeatureFlagTargetingAttribute.USER_ID;
  if (attribute === FeatureFlagTargetingAttribute.ORGANIZATION_ID) {
    return context.organizationId;
  }
  return context.userId;
}

export function evaluateFeatureFlag(
  flag: IFeatureFlag | undefined,
  context: IFeatureFlagContext,
  options: IFeatureFlagEvaluationOptions = {},
): IFeatureFlagEvaluationResult {
  const isEnabledByDefault = options.defaultValue ?? false;

  if (!flag) {
    return {
      enabled: isEnabledByDefault,
      usedDefault: true,
      reason: 'missing_flag',
    };
  }

  if (!flag.enabled) {
    return { enabled: false, usedDefault: false, reason: 'disabled' };
  }

  if (flag.type === FeatureFlagType.BOOLEAN) {
    return { enabled: true, usedDefault: false, reason: 'boolean' };
  }

  if (flag.type === FeatureFlagType.PERCENTAGE) {
    const percentage = flag.rolloutPercentage;
    if (
      typeof percentage !== 'number' ||
      !Number.isFinite(percentage) ||
      percentage < 0 ||
      percentage > 100
    ) {
      return {
        enabled: isEnabledByDefault,
        usedDefault: true,
        reason: 'invalid_percentage',
      };
    }

    const targetingValue = resolveTargetingValue(flag, context);
    if (!targetingValue) {
      return {
        enabled: isEnabledByDefault,
        usedDefault: true,
        reason: 'missing_targeting',
      };
    }

    const bucket = computeRolloutBucket(flag.key, targetingValue);
    return {
      enabled: bucket < percentage,
      usedDefault: false,
      reason: 'percentage',
    };
  }

  return {
    enabled: isEnabledByDefault,
    usedDefault: true,
    reason: 'missing_flag',
  };
}

export function isValidFeatureFlagShape(value: unknown): value is IFeatureFlag {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const flag = value as Record<string, unknown>;
  if (typeof flag.key !== 'string' || flag.key.length === 0) {
    return false;
  }
  if (typeof flag.enabled !== 'boolean') {
    return false;
  }
  if (
    flag.type !== FeatureFlagType.BOOLEAN &&
    flag.type !== FeatureFlagType.PERCENTAGE
  ) {
    return false;
  }
  if (typeof flag.environment !== 'string') {
    return false;
  }
  if (
    typeof flag.version !== 'number' ||
    !Number.isInteger(flag.version) ||
    flag.version < 1
  ) {
    return false;
  }
  if (
    typeof flag.createdAt !== 'string' ||
    typeof flag.updatedAt !== 'string'
  ) {
    return false;
  }
  if (flag.type === FeatureFlagType.PERCENTAGE) {
    if (
      typeof flag.rolloutPercentage !== 'number' ||
      flag.rolloutPercentage < 0 ||
      flag.rolloutPercentage > 100
    ) {
      return false;
    }
    const targeting = flag.targeting as Record<string, unknown> | undefined;
    if (
      !targeting ||
      (targeting.attribute !== FeatureFlagTargetingAttribute.USER_ID &&
        targeting.attribute !== FeatureFlagTargetingAttribute.ORGANIZATION_ID)
    ) {
      return false;
    }
  }
  return true;
}
