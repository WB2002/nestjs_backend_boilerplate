import { FeatureFlagCache } from '../feature-flag.cache';
import { FeatureFlagEventType, FeatureFlagType, IFeatureFlag } from '../types';

function flag(overrides: Partial<IFeatureFlag> = {}): IFeatureFlag {
  return {
    key: 'new-checkout',
    enabled: true,
    type: FeatureFlagType.BOOLEAN,
    environment: 'production',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 10,
    ...overrides,
  };
}

describe('FeatureFlagCache', () => {
  it('replaces the snapshot atomically and skips malformed entries', () => {
    const cache = new FeatureFlagCache();
    const skippedInvalidFlags = cache.replaceAll([
      flag({ key: 'a', version: 1 }),
      { key: 'bad' } as unknown as IFeatureFlag,
      flag({ key: 'b', version: 2 }),
    ]);
    expect(skippedInvalidFlags).toBe(1);
    expect(cache.size()).toBe(2);
    expect(cache.get('a')?.version).toBe(1);
    expect(cache.get('bad')).toBeUndefined();
  });

  it('ignores stale version updates', () => {
    const cache = new FeatureFlagCache();
    cache.replaceAll([flag({ version: 15 })]);
    expect(cache.applyUpdate(flag({ version: 13 }))).toBe(false);
    expect(cache.applyUpdate(flag({ version: 15 }))).toBe(false);
    expect(cache.applyUpdate(flag({ version: 16, enabled: false }))).toBe(true);
    expect(cache.get('new-checkout')?.version).toBe(16);
    expect(cache.get('new-checkout')?.enabled).toBe(false);
  });

  it('ignores stale deletes and applies newer deletes', () => {
    const cache = new FeatureFlagCache();
    cache.replaceAll([flag({ version: 10 })]);
    expect(cache.applyDelete('new-checkout', 9)).toBe(false);
    expect(cache.size()).toBe(1);
    expect(cache.applyDelete('new-checkout', 11)).toBe(true);
    expect(cache.size()).toBe(0);
  });

  it('ignores events for other environments', () => {
    const cache = new FeatureFlagCache();
    cache.replaceAll([flag({ version: 1 })]);
    const hasAppliedEvent = cache.applyEvent(
      {
        event: FeatureFlagEventType.FLAG_UPDATED,
        environment: 'staging',
        key: 'new-checkout',
        version: 2,
      },
      'production',
      flag({ version: 2 }),
    );
    expect(hasAppliedEvent).toBe(false);
    expect(cache.get('new-checkout')?.version).toBe(1);
  });

  it('does not mutate the previous map reference on update', () => {
    const cache = new FeatureFlagCache();
    cache.replaceAll([flag({ version: 1 })]);
    const before = cache.getSnapshot();
    cache.applyUpdate(flag({ version: 2 }));
    expect(before.get('new-checkout')?.version).toBe(1);
    expect(cache.get('new-checkout')?.version).toBe(2);
  });
});
