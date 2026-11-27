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

  it('parses numeric string RATE_LIMIT_GLOBAL_IP_LIMIT overrides', () => {
    const env = new Map<string, string>([
      ['NODE_ENV', 'test'],
      ['RATE_LIMIT_GLOBAL_IP_LIMIT', '100000'],
    ]);
    const resolved = resolveDefaultRateLimitMethods({
      get: (key: string) => env.get(key),
    } as never);
    expect(resolved[0]?.limit).toBe(100_000);
  });
});
