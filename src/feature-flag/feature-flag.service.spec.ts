import { FeatureFlagCache } from './feature-flag.cache';
import { evaluateFeatureFlag } from './feature-flag.evaluator';
import {
  FeatureFlagType,
  IFeatureFlag,
} from './types';

/**
 * Simulates request-path evaluation using only the local cache (no Redis).
 */
describe('FeatureFlagService evaluation path (local)', () => {
  it('evaluates from in-memory snapshot without network', () => {
    const cache = new FeatureFlagCache();
    const flag: IFeatureFlag = {
      key: 'new-checkout',
      enabled: true,
      type: FeatureFlagType.BOOLEAN,
      environment: 'production',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
    };
    cache.replaceAll([flag]);

    const isEnabled = (key: string, defaultValue = false): boolean => {
      return evaluateFeatureFlag(cache.get(key), {}, { defaultValue }).enabled;
    };

    expect(isEnabled('new-checkout')).toBe(true);
    expect(isEnabled('missing')).toBe(false);
    expect(isEnabled('missing', true)).toBe(true);
  });

  it('continues serving local snapshot when Redis is considered unavailable', () => {
    const cache = new FeatureFlagCache();
    cache.replaceAll([
      {
        key: 'new-checkout',
        enabled: true,
        type: FeatureFlagType.BOOLEAN,
        environment: 'production',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 5,
      },
    ]);

    // Simulate outage: no cache mutation, evaluation still works.
    expect(
      evaluateFeatureFlag(cache.get('new-checkout'), {}).enabled,
    ).toBe(true);
  });
});
