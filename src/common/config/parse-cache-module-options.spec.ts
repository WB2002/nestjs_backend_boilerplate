import { parseCacheModuleOptions } from './parse-cache-module-options';

describe('parseCacheModuleOptions', () => {
  it('parses jitter ratio', () => {
    const cs = {
      get: (k: string) =>
        k === 'CACHE_TTL_JITTER_RATIO' ? '0.15' : undefined,
    };
    expect(parseCacheModuleOptions(cs as never).ttlJitterRatio).toBe(0.15);
  });

  it('returns empty object when unset', () => {
    const cs = { get: () => undefined };
    expect(parseCacheModuleOptions(cs as never)).toEqual({});
  });

  it('rejects invalid jitter ratio', () => {
    const cs = { get: () => '2' };
    expect(() => parseCacheModuleOptions(cs as never)).toThrow(
      /CACHE_TTL_JITTER_RATIO/,
    );
  });
});
