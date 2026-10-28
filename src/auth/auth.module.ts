import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { User, UserSchema } from './schemas/user.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AccessTokenAuthenticator } from './access-token-authenticator.service';

@Module({
  imports: [
    PassportModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        privateKey: (
          configService.get<string>('JWT_PRIVATE_KEY') || ''
        ).replace(/\\n/g, '\n'),
        publicKey: (configService.get<string>('JWT_PUBLIC_KEY') || '').replace(
          /\\n/g,
          '\n',
        ),
        signOptions: {
          expiresIn: configService.get<number>('ACCESS_TOKEN_TTL', 900),
          algorithm: 'RS256',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    AccessTokenAuthenticator,
  ],
  exports: [AuthService, AccessTokenAuthenticator],
})
export class AuthModule {}
