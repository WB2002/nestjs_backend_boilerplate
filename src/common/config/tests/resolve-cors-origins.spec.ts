import {
  assertProductionAllowedOrigins,
  resolveCorsOrigins,
  toFastifyCorsOrigin,
} from '../resolve-cors-origins';

describe('resolveCorsOrigins', () => {
  it('requires explicit list in production', () => {
    const resolved = resolveCorsOrigins({
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ALLOWED_ORIGINS') return 'https://app.example.com';
        return undefined;
      },
    } as never);
    expect(resolved).toEqual({
      mode: 'list',
      origins: ['https://app.example.com'],
    });
  });

  it('allows all in development when origins unset', () => {
    const resolved = resolveCorsOrigins({
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      },
    } as never);
    expect(resolved).toEqual({ mode: 'allow-all' });
  });
});

describe('assertProductionAllowedOrigins', () => {
  it('throws when production has empty origins', () => {
    expect(() => assertProductionAllowedOrigins('production', [])).toThrow(
      /ALLOWED_ORIGINS/,
    );
  });
});

describe('toFastifyCorsOrigin', () => {
  it('never returns asterisk string', () => {
    expect(toFastifyCorsOrigin({ mode: 'allow-all' })).toBe(true);
    expect(
      toFastifyCorsOrigin({ mode: 'list', origins: ['https://a'] }),
    ).toEqual(['https://a']);
  });
});
