import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { User } from './schemas/user.schema';
import { Session } from './schemas/session.schema';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly redis: Redis;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Session.name) private sessionModel: Model<Session>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
    });
  }

  async register(registerDto: RegisterDto): Promise<void> {
    const { email, password } = registerDto;
    const existingUser = await this.userModel.findOne({ email }).exec();
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 64 * 1024,
      timeCost: 3,
      parallelism: 4,
    });

    const newUser = new this.userModel({
      email,
      passwordHash,
    });

    await newUser.save();
  }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.userModel.findOne({ email }).exec();
    if (user && user.isActive) {
      const isValid = await argon2.verify(user.passwordHash, pass);
      if (isValid) {
        const { passwordHash, ...result } = user.toObject();
        return result;
      }
    }
    return null;
  }

  async createSession(userId: string, userAgent: string, ip: string) {
    const token = uuidv4();
    const sessionTtl = this.configService.get<number>('SESSION_TTL', 604800);
    const expiresAt = new Date(Date.now() + sessionTtl * 1000);

    const session = new this.sessionModel({
      userId,
      token,
      userAgent,
      ip,
      expiresAt,
    });

    await session.save();

    const accessToken = await this.signAccessToken(userId, (await this.userModel.findById(userId)).email, token);

    return {
      accessToken,
      sessionId: token,
    };
  }

  async refreshSession(incomingToken: string) {
    const newToken = uuidv4();
    const sessionTtl = this.configService.get<number>('SESSION_TTL', 604800);
    const newExpiresAt = new Date(Date.now() + sessionTtl * 1000);

    // Atomic update to prevent replay attacks
    const session = await this.sessionModel
      .findOneAndUpdate(
        { token: incomingToken, expiresAt: { $gt: new Date() } },
        { token: newToken, expiresAt: newExpiresAt },
        { new: true },
      )
      .exec();

    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const user = await this.userModel.findById(session.userId).exec();
    const accessToken = await this.signAccessToken(user.id, user.email, newToken);

    return {
      accessToken,
      sessionId: newToken,
    };
  }

  async logout(sessionId: string) {
    const session = await this.sessionModel
      .findOneAndDelete({ token: sessionId })
      .exec();

    if (session) {
      const accessTokenTtl = this.configService.get<number>('ACCESS_TOKEN_TTL', 900);
      // Revoke the JTI in Redis for the remaining lifetime of the access token
      await this.redis.setex(`revoked_jti:${sessionId}`, accessTokenTtl, 'true');
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    const result = await this.redis.get(`revoked_jti:${jti}`);
    return !!result;
  }

  private async signAccessToken(userId: string, email: string, jti: string): Promise<string> {
    const payload = { sub: userId, email, jti };
    return this.jwtService.signAsync(payload);
  }
}
