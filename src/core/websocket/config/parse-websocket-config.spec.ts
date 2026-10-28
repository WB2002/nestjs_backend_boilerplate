import {
  assertWebSocketProductionOrigins,
  parseWebSocketConfig,
} from './parse-websocket-config';

describe('parseWebSocketConfig', () => {
  it('disables query token by default and enables redis adapter in production', () => {
    const config = parseWebSocketConfig({
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ALLOWED_ORIGINS') return 'https://app.example.com';
        return undefined;
      },
    } as never);

    expect(config.allowQueryToken).toBe(false);
    expect(config.corsOrigins).toEqual(['https://app.example.com']);
    expect(config.redisAdapterEnabled).toBe(true);
  });

  it('allows permissive cors in development when origins unset', () => {
    const config = parseWebSocketConfig({
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      },
    } as never);

    expect(config.corsOrigins).toBe(true);
  });

  it('throws when production websocket enabled without origins', () => {
    const config = parseWebSocketConfig({
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      },
    } as never);

    expect(() =>
      assertWebSocketProductionOrigins(config, 'production'),
    ).toThrow(/ALLOWED_ORIGINS/);
  });
});
