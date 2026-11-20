import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '@/types';
import { AuthService } from './auth.service';
import { UserRole } from './constants';
import { AuthenticatedUser } from './types/authenticated-user.types';

@Injectable()
export class AccessTokenAuthenticator {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  async verifyAccessToken(rawToken: string): Promise<AuthenticatedUser> {
    const token = rawToken.trim();
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const publicKey = (
      this.configService.get<string>('JWT_PUBLIC_KEY') ?? ''
    ).replace(/\\n/g, '\n');

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        publicKey,
        algorithms: ['RS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    return this.userFromVerifiedPayload(payload);
  }

  async userFromVerifiedPayload(
    payload: JwtPayload,
  ): Promise<AuthenticatedUser> {
    const isRevoked = await this.authService.isRevoked(payload.jti);
    if (isRevoked) {
      throw new UnauthorizedException('Session has been revoked');
    }

    const role = await this.resolveRoleForPayload(payload);

    return {
      id: payload.sub,
      email: payload.email,
      jti: payload.jti,
      role,
    };
  }

  private async resolveRoleForPayload(payload: JwtPayload): Promise<UserRole> {
    if (payload.role === UserRole.ADMIN || payload.role === UserRole.USER) {
      return payload.role;
    }
    return this.authService.resolveAuthoritativeRoleForUserId(payload.sub);
  }
}
