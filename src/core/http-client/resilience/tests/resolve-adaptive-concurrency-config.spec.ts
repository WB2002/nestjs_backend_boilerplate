import { resolveAdaptiveConcurrencyConfig } from '../resolve-adaptive-concurrency-config';

describe('resolveAdaptiveConcurrencyConfig', () => {
  it('maps maxConcurrent to maxLimit when adaptive block omitted', () => {
    const cfg = resolveAdaptiveConcurrencyConfig(
      { maxConcurrent: 40, mode: 'adaptive' },
      1,
    );
    expect(cfg.maxLimit).toBe(40);
    expect(cfg.initialLimit).toBe(10);
    expect(cfg.minLimit).toBe(1);
    expect(cfg.algorithm).toBe('vegas');
  });

  it('scales limits down with clusterAware and instance count', () => {
    const cfg = resolveAdaptiveConcurrencyConfig(
      {
        maxConcurrent: 50,
        mode: 'adaptive',
        clusterAware: true,
        adaptive: { initialLimit: 20, minLimit: 4, maxLimit: 50 },
      },
      10,
    );
    expect(cfg.maxLimit).toBe(5);
    expect(cfg.initialLimit).toBe(2);
    expect(cfg.minLimit).toBe(1);
  });
});
