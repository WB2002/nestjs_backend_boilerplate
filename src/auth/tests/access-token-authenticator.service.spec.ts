jest.mock('../auth.service', () => ({
  AuthService: jest.fn(),
}));

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AccessTokenAuthenticator } from '../access-token-authenticator.service';
import { AuthService } from '../auth.service';
import { UserRole } from '../constants';

describe('AccessTokenAuthenticator', () => {
  const publicKey = 'test-public-key';
  const jwtService = {
    verifyAsync: jest.fn(),
  } as unknown as JwtService;
  const authService = {
    isRevoked: jest.fn(),
    resolveAuthoritativeRoleForUserId: jest.fn(),
  } as unknown as AuthService;
  const configService = {
    get: jest.fn((key: string) =>
      key === 'JWT_PUBLIC_KEY' ? publicKey : undefined,
    ),
  } as unknown as ConfigService;

  const authenticator = new AccessTokenAuthenticator(
    jwtService,
    authService,
    configService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects empty token', async () => {
    await expect(authenticator.verifyAccessToken('')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns user when JWT valid and not revoked', async () => {
    (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      email: 'a@example.com',
      jti: 'jti-1',
      role: UserRole.ADMIN,
    });
    (authService.isRevoked as jest.Mock).mockResolvedValue(false);
    (
      authService.resolveAuthoritativeRoleForUserId as jest.Mock
    ).mockResolvedValue(UserRole.ADMIN);

    await expect(authenticator.verifyAccessToken('tok')).resolves.toEqual({
      id: 'user-1',
      email: 'a@example.com',
      jti: 'jti-1',
      role: UserRole.ADMIN,
    });
  });

  it('rejects revoked session', async () => {
    (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      email: 'a@example.com',
      jti: 'jti-1',
      role: UserRole.USER,
    });
    (authService.isRevoked as jest.Mock).mockResolvedValue(true);

    await expect(authenticator.verifyAccessToken('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('uses embedded JWT role on the hot path without Mongo lookup', async () => {
    (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      email: 'a@example.com',
      jti: 'jti-1',
      role: UserRole.ADMIN,
    });
    (authService.isRevoked as jest.Mock).mockResolvedValue(false);

    await expect(authenticator.verifyAccessToken('tok')).resolves.toEqual({
      id: 'user-1',
      email: 'a@example.com',
      jti: 'jti-1',
      role: UserRole.ADMIN,
    });
    expect(
      authService.resolveAuthoritativeRoleForUserId,
    ).not.toHaveBeenCalled();
  });

  it('rejects when authoritative role lookup fails', async () => {
    (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      email: 'a@example.com',
      jti: 'jti-1',
      role: 'legacy-unknown',
    });
    (authService.isRevoked as jest.Mock).mockResolvedValue(false);
    (
      authService.resolveAuthoritativeRoleForUserId as jest.Mock
    ).mockRejectedValue(new UnauthorizedException('User not found'));

    await expect(authenticator.verifyAccessToken('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
