import { resolveEffectiveMaxConcurrent } from './resolve-max-concurrent';

describe('resolveEffectiveMaxConcurrent', () => {
  it('returns maxConcurrent when clusterAware is omitted', () => {
    expect(
      resolveEffectiveMaxConcurrent({ maxConcurrent: 50 }, 10),
    ).toBe(50);
  });

  it('returns maxConcurrent when clusterAware is false', () => {
    expect(
      resolveEffectiveMaxConcurrent(
        { maxConcurrent: 50, clusterAware: false },
        10,
      ),
    ).toBe(50);
  });

  it('divides budget by instance count when clusterAware is true', () => {
    expect(
      resolveEffectiveMaxConcurrent(
        { maxConcurrent: 50, clusterAware: true },
        10,
      ),
    ).toBe(5);
  });

  it('never returns less than 1', () => {
    expect(
      resolveEffectiveMaxConcurrent(
        { maxConcurrent: 3, clusterAware: true },
        100,
      ),
    ).toBe(1);
  });

  it('treats invalid instance count as at least 1', () => {
    expect(
      resolveEffectiveMaxConcurrent(
        { maxConcurrent: 10, clusterAware: true },
        0,
      ),
    ).toBe(10);
  });
});
