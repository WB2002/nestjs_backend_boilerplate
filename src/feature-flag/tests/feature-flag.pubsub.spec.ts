import { FeatureFlagCache } from '../feature-flag.cache';
import { FeatureFlagEventType, FeatureFlagType, IFeatureFlag } from '../types';

describe('Pub/Sub + reconciliation recovery', () => {
  const flag = (version: number): IFeatureFlag => ({
    key: 'new-checkout',
    enabled: true,
    type: FeatureFlagType.BOOLEAN,
    environment: 'production',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version,
  });

  it('applies FLAG_UPDATED then ignores stale versions', () => {
    const cache = new FeatureFlagCache();
    cache.replaceAll([flag(10)]);

    expect(
      cache.applyEvent(
        {
          event: FeatureFlagEventType.FLAG_UPDATED,
          environment: 'production',
          key: 'new-checkout',
          version: 11,
        },
        'production',
        flag(11),
      ),
    ).toBe(true);

    expect(
      cache.applyEvent(
        {
          event: FeatureFlagEventType.FLAG_UPDATED,
          environment: 'production',
          key: 'new-checkout',
          version: 9,
        },
        'production',
        flag(9),
      ),
    ).toBe(false);

    expect(cache.get('new-checkout')?.version).toBe(11);
  });

  it('recovers missed Pub/Sub via full reconciliation snapshot', () => {
    const cache = new FeatureFlagCache();
    cache.replaceAll([flag(10)]);

    // Missed event would have set version 12; reconcile loads authoritative state.
    cache.replaceAll([flag(12), flag(1)]);
    // Second flag has same key overwritten — use distinct keys:
    cache.replaceAll([
      flag(12),
      {
        ...flag(3),
        key: 'new-payment',
      },
    ]);

    expect(cache.get('new-checkout')?.version).toBe(12);
    expect(cache.get('new-payment')?.version).toBe(3);
    expect(cache.size()).toBe(2);
  });

  it('applies FLAG_DELETED', () => {
    const cache = new FeatureFlagCache();
    cache.replaceAll([flag(4)]);
    expect(
      cache.applyEvent(
        {
          event: FeatureFlagEventType.FLAG_DELETED,
          environment: 'production',
          key: 'new-checkout',
          version: 5,
        },
        'production',
        null,
      ),
    ).toBe(true);
    expect(cache.get('new-checkout')).toBeUndefined();
  });
});
