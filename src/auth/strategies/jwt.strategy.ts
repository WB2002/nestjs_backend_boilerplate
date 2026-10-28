import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';
import { ACCESS_TOKEN_COOKIE } from '@/common/constants';
import { JwtPayload } from '@/types';
import { AccessTokenAuthenticator } from '../access-token-authenticator.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly accessTokenAuthenticator: AccessTokenAuthenticator,
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

  validate(payload: JwtPayload) {
    return this.accessTokenAuthenticator.userFromVerifiedPayload(payload);
  }
}
