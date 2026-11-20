import { resolveHealthResponseMode } from '../resolve-health-response-mode';

describe('resolveHealthResponseMode', () => {
  it('is minimal in production by default', () => {
    expect(
      resolveHealthResponseMode({
        get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined),
      } as never),
    ).toBe('minimal');
  });

  it('is detailed when HEALTH_EXPOSE_DEPENDENCIES=true', () => {
    expect(
      resolveHealthResponseMode({
        get: (key: string) => {
          if (key === 'NODE_ENV') return 'production';
          if (key === 'HEALTH_EXPOSE_DEPENDENCIES') return 'true';
          return undefined;
        },
      } as never),
    ).toBe('detailed');
  });
});
