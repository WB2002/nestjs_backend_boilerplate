import {
  computeRolloutBucket,
  evaluateFeatureFlag,
  isValidFeatureFlagShape,
} from '../feature-flag.evaluator';
import {
  FeatureFlagTargetingAttribute,
  FeatureFlagType,
  IFeatureFlag,
} from '../types';

function booleanFlag(overrides: Partial<IFeatureFlag> = {}): IFeatureFlag {
  return {
    key: 'new-checkout',
    enabled: true,
    type: FeatureFlagType.BOOLEAN,
    environment: 'production',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function percentageFlag(overrides: Partial<IFeatureFlag> = {}): IFeatureFlag {
  return {
    key: 'new-checkout',
    enabled: true,
    type: FeatureFlagType.PERCENTAGE,
    rolloutPercentage: 10,
    targeting: { attribute: FeatureFlagTargetingAttribute.USER_ID },
    environment: 'production',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('feature-flag.evaluator', () => {
  describe('boolean', () => {
    it('returns true when enabled', () => {
      const result = evaluateFeatureFlag(booleanFlag({ enabled: true }), {});
      expect(result).toEqual({
        enabled: true,
        usedDefault: false,
        reason: 'boolean',
      });
    });

    it('returns false when disabled', () => {
      const result = evaluateFeatureFlag(booleanFlag({ enabled: false }), {});
      expect(result).toEqual({
        enabled: false,
        usedDefault: false,
        reason: 'disabled',
      });
    });
  });

  describe('percentage', () => {
    it('is deterministic for the same user and flag', () => {
      const flag = percentageFlag();
      const a = evaluateFeatureFlag(flag, { userId: 'user-123' });
      const b = evaluateFeatureFlag(flag, { userId: 'user-123' });
      expect(a.enabled).toBe(b.enabled);
      expect(a.reason).toBe('percentage');
    });

    it('returns the same bucket across instances (cross-service formula)', () => {
      const bucketA = computeRolloutBucket('new-checkout', 'user-123');
      const bucketB = computeRolloutBucket('new-checkout', 'user-123');
      expect(bucketA).toBe(bucketB);
      expect(bucketA).toBeGreaterThanOrEqual(0);
      expect(bucketA).toBeLessThan(100);
    });

    it('distributes approximately 10% for a large sample', () => {
      const flag = percentageFlag({ rolloutPercentage: 10 });
      let enabled = 0;
      const sample = 5_000;
      for (let i = 0; i < sample; i += 1) {
        const result = evaluateFeatureFlag(flag, { userId: `user-${i}` });
        if (result.enabled) {
          enabled += 1;
        }
      }
      const ratio = enabled / sample;
      expect(ratio).toBeGreaterThan(0.07);
      expect(ratio).toBeLessThan(0.13);
    });

    it('uses default when targeting context is missing', () => {
      const result = evaluateFeatureFlag(
        percentageFlag(),
        {},
        {
          defaultValue: false,
        },
      );
      expect(result).toEqual({
        enabled: false,
        usedDefault: true,
        reason: 'missing_targeting',
      });
    });

    it('uses organizationId when targeting attribute requires it', () => {
      const flag = percentageFlag({
        targeting: {
          attribute: FeatureFlagTargetingAttribute.ORGANIZATION_ID,
        },
      });
      const withOrg = evaluateFeatureFlag(flag, { organizationId: 'org-1' });
      const withoutOrg = evaluateFeatureFlag(flag, { userId: 'user-1' });
      expect(withOrg.reason).toBe('percentage');
      expect(withoutOrg.reason).toBe('missing_targeting');
    });

    it('returns false when percentage flag is disabled', () => {
      const result = evaluateFeatureFlag(percentageFlag({ enabled: false }), {
        userId: 'user-1',
      });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });

  describe('missing flag', () => {
    it('uses defaultValue', () => {
      expect(
        evaluateFeatureFlag(undefined, {}, { defaultValue: true }),
      ).toEqual({
        enabled: true,
        usedDefault: true,
        reason: 'missing_flag',
      });
      expect(evaluateFeatureFlag(undefined, {})).toEqual({
        enabled: false,
        usedDefault: true,
        reason: 'missing_flag',
      });
    });
  });

  describe('isValidFeatureFlagShape', () => {
    it('accepts valid flags and rejects malformed ones', () => {
      expect(isValidFeatureFlagShape(booleanFlag())).toBe(true);
      expect(isValidFeatureFlagShape(percentageFlag())).toBe(true);
      expect(isValidFeatureFlagShape({ key: 'x' })).toBe(false);
      expect(
        isValidFeatureFlagShape(percentageFlag({ rolloutPercentage: 150 })),
      ).toBe(false);
    });
  });
});
