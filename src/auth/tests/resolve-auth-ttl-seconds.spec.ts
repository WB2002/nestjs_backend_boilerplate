import { generateKeyPairSync } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  resolveAuthTtlSeconds,
} from '../resolve-auth-ttl-seconds';

describe('resolveAuthTtlSeconds', () => {
  it('coerces numeric string env values to seconds so JWTs do not expire in milliseconds', async () => {
    const config = new ConfigService({
      ACCESS_TOKEN_TTL: '900',
      SESSION_TTL: '604800',
    });

    const accessTokenTtlSeconds = resolveAuthTtlSeconds(
      config,
      'ACCESS_TOKEN_TTL',
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    );
    const sessionTtlSeconds = resolveAuthTtlSeconds(
      config,
      'SESSION_TTL',
      DEFAULT_SESSION_TTL_SECONDS,
    );

    expect(accessTokenTtlSeconds).toBe(900);
    expect(sessionTtlSeconds).toBe(604800);

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const jwtService = new JwtService({
      privateKey,
      publicKey,
      signOptions: {
        expiresIn: accessTokenTtlSeconds,
        algorithm: 'RS256',
      },
    });

    const token = await jwtService.signAsync({ sub: 'user-1' });
    const decoded = jwtService.verify<{
      sub: string;
      iat: number;
      exp: number;
    }>(token, { publicKey, algorithms: ['RS256'] });

    expect(decoded.exp - decoded.iat).toBe(900);
  });

  it('falls back to the default when the env value is missing or invalid', () => {
    const emptyConfig = new ConfigService({});
    const invalidConfig = new ConfigService({
      ACCESS_TOKEN_TTL: 'not-a-number',
      SESSION_TTL: '0',
    });

    expect(
      resolveAuthTtlSeconds(
        emptyConfig,
        'ACCESS_TOKEN_TTL',
        DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      ),
    ).toBe(900);
    expect(
      resolveAuthTtlSeconds(
        invalidConfig,
        'ACCESS_TOKEN_TTL',
        DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      ),
    ).toBe(900);
    expect(
      resolveAuthTtlSeconds(
        invalidConfig,
        'SESSION_TTL',
        DEFAULT_SESSION_TTL_SECONDS,
      ),
    ).toBe(604800);
  });
});
