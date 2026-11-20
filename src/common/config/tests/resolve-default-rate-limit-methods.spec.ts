import { resolveDefaultRateLimitMethods } from '../resolve-default-rate-limit-methods';

describe('resolveDefaultRateLimitMethods', () => {
  it('uses a higher dev limit than production default', () => {
    const dev = resolveDefaultRateLimitMethods({
      get: (key: string) => (key === 'NODE_ENV' ? 'development' : undefined),
    } as never);
    const prod = resolveDefaultRateLimitMethods({
      get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined),
    } as never);
    expect(dev[0]?.limit).toBeGreaterThan(prod[0]?.limit ?? 0);
  });
});
