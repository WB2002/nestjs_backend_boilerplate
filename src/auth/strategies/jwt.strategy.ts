import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';
import { AuthService } from '../auth.service';
import { ACCESS_TOKEN_COOKIE } from '@/common/constants';
import { JwtPayload } from '@/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: FastifyRequest): string | null => {
          const token = request?.cookies?.[ACCESS_TOKEN_COOKIE];
          return typeof token === 'string' ? token : null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: (configService.get<string>('JWT_PUBLIC_KEY') || '').replace(
        /\\n/g,
        '\n',
      ),
      algorithms: ['RS256'],
    });
  }

  async validate(payload: JwtPayload) {
    const isRevoked = await this.authService.isRevoked(payload.jti);
    if (isRevoked) {
      throw new UnauthorizedException('Session has been revoked');
    }
    return {
      id: payload.sub,
      email: payload.email,
      jti: payload.jti,
      role: payload.role ?? 'user',
    };
  }
}
