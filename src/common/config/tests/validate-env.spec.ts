import { validateEnv } from '../validate-env';

const requiredKeys = [
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'COOKIE_SECRET',
  'ACCESS_TOKEN_TTL',
  'SESSION_TTL',
  'MONGO_URI',
  'REDIS_HOST',
  'REDIS_PORT',
  'HCAPTCHA_SECRET',
  'GEOIP_DATABASE_PATH',
] as const;

function validConfig(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    JWT_PRIVATE_KEY: 'private',
    JWT_PUBLIC_KEY: 'public',
    COOKIE_SECRET: 'secret',
    ACCESS_TOKEN_TTL: '900',
    SESSION_TTL: '604800',
    MONGO_URI: 'mongodb://localhost:27017/test',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    HCAPTCHA_SECRET: 'test-hcaptcha-secret',
    GEOIP_DATABASE_PATH: '/data/GeoLite2-Country.mmdb',
  };
  return { ...base, ...overrides };
}

describe('validateEnv', () => {
  it('returns config when all required keys are present', () => {
    const config = validConfig({ PORT: '3000' });
    expect(validateEnv(config)).toBe(config);
  });

  it('allows optional keys to be omitted', () => {
    const config = validConfig();
    expect(validateEnv(config)).toEqual(config);
  });

  it('throws when a single required key is missing', () => {
    const config = validConfig();
    delete config.MONGO_URI;

    expect(() => validateEnv(config)).toThrow(
      'Missing required environment variables: MONGO_URI',
    );
  });

  it('throws listing all missing required keys', () => {
    const config = validConfig();
    delete config.JWT_PRIVATE_KEY;
    delete config.REDIS_HOST;

    expect(() => validateEnv(config)).toThrow(
      'Missing required environment variables: JWT_PRIVATE_KEY, REDIS_HOST',
    );
  });

  it('treats empty string as missing for required keys', () => {
    const config = validConfig({ COOKIE_SECRET: '' });

    expect(() => validateEnv(config)).toThrow(
      'Missing required environment variables: COOKIE_SECRET',
    );
  });

  it('treats whitespace-only string as missing for required keys', () => {
    const config = validConfig({ SESSION_TTL: '   ' });

    expect(() => validateEnv(config)).toThrow(
      'Missing required environment variables: SESSION_TTL',
    );
  });

  it('ignores extra env keys not in the schema', () => {
    const config = validConfig({ CUSTOM_FLAG: '1' });
    expect(validateEnv(config)).toEqual(config);
  });

  it('requires every hard-required key from the schema', () => {
    for (const key of requiredKeys) {
      const configEntries = Object.entries(validConfig()).filter(
        ([envKey]) => envKey !== key,
      );
      const config = Object.fromEntries(configEntries);
      expect(() => validateEnv(config)).toThrow(
        expect.objectContaining({
          message: expect.stringMatching(
            /Missing required environment variables/,
          ),
        }),
      );
      expect(() => validateEnv(config)).toThrow(
        expect.objectContaining({
          message: expect.stringContaining(key),
        }),
      );
    }
  });

  it('throws when harness enabled in production', () => {
    const config = validConfig({
      NODE_ENV: 'production',
      CONFORMANCE_HARNESS_ENABLED: 'true',
    });
    expect(() => validateEnv(config)).toThrow(
      /CONFORMANCE_HARNESS_ENABLED cannot be true/,
    );
  });

  it('allows harness outside production', () => {
    const config = validConfig({
      NODE_ENV: 'test',
      CONFORMANCE_HARNESS_ENABLED: 'true',
    });
    expect(validateEnv(config)).toBe(config);
  });
});
