import { applyTtlJitter } from './apply-ttl-jitter';

describe('applyTtlJitter', () => {
  it('returns base TTL when ratio is 0', () => {
    const base = { softTtlMs: 1000, hardTtlMs: 2000 };
    expect(applyTtlJitter(base, 0, () => 1)).toEqual(base);
  });

  it('adds jitter bounded by ratio', () => {
    const base = { softTtlMs: 1000, hardTtlMs: 2000 };
    const out = applyTtlJitter(base, 0.1, () => 1);
    expect(out.softTtlMs).toBe(1100);
    expect(out.hardTtlMs).toBe(2200);
  });

  it('throws when jitter breaks soft <= hard', () => {
    let call = 0;
    expect(() =>
      applyTtlJitter({ softTtlMs: 100, hardTtlMs: 105 }, 0.5, () =>
        call++ === 0 ? 1 : 0,
      ),
    ).toThrow(/softTtlMs must be <= hardTtlMs/);
  });
});
