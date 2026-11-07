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
import { User, Session } from './schemas';
import { RegisterDto } from './dto';
import { RedisService } from '@/common/redis/redis.service';
import { UserRole } from './constants';
import { PasswordHashBulkhead } from './password/password-hash-bulkhead';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Session.name) private sessionModel: Model<Session>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redisService: RedisService,
    private passwordHashBulkhead: PasswordHashBulkhead,
  ) {}

  private get redis() {
    return this.redisService.getClient();
  }

  async register(registerDto: RegisterDto): Promise<void> {
    const { email, password } = registerDto;
    const existingUser = await this.userModel.findOne({ email }).exec();
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await this.passwordHashBulkhead.run(() =>
      argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 64 * 1024,
        timeCost: 3,
        parallelism: 4,
      }),
    );

    const newUser = new this.userModel({
      email,
      passwordHash,
      role: this.resolveRoleForEmail(email),
    });

    await newUser.save();
  }

  async validateUser(
    email: string,
    pass: string,
  ): Promise<Record<string, unknown> | null> {
    const user = await this.userModel.findOne({ email }).exec();
    if (user && user.isActive) {
      const isValid = await this.passwordHashBulkhead.run(() =>
        argon2.verify(user.passwordHash, pass),
      );
      if (isValid) {
        const plain = user.toObject() as unknown as Record<string, unknown>;
        delete plain.passwordHash;
        return plain;
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

    const userForToken = await this.userModel.findById(userId).exec();
    if (!userForToken) {
      throw new UnauthorizedException('User not found');
    }

    const role = await this.ensureAdminRoleIfAllowlisted(userForToken);

    const accessToken = await this.signAccessToken(
      userId,
      userForToken.email,
      token,
      role,
    );

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
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const role = await this.ensureAdminRoleIfAllowlisted(user);

    const accessToken = await this.signAccessToken(
      user.id,
      user.email,
      newToken,
      role,
    );

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
      const accessTokenTtl = this.configService.get<number>(
        'ACCESS_TOKEN_TTL',
        900,
      );
      // Revoke the JTI in Redis for the remaining lifetime of the access token
      await this.redis.setex(
        `revoked_jti:${sessionId}`,
        accessTokenTtl,
        'true',
      );
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    const tokenPair = await this.redis.get(`revoked_jti:${jti}`);
    return !!tokenPair;
  }

  private async signAccessToken(
    userId: string,
    email: string,
    jti: string,
    role: UserRole,
  ): Promise<string> {
    const payload = { sub: userId, email, jti, role };
    return this.jwtService.signAsync(payload);
  }

  private resolveRoleForEmail(email: string): UserRole {
    return this.isAdminEmail(email) ? UserRole.ADMIN : UserRole.USER;
  }

  private isAdminEmail(email: string): boolean {
    const raw = this.configService.get<string>('FEATURE_FLAG_ADMIN_EMAILS', '');
    if (!raw) {
      return false;
    }
    const allowlist = raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return allowlist.includes(email.trim().toLowerCase());
  }

  private async ensureAdminRoleIfAllowlisted(user: User): Promise<UserRole> {
    const currentRole = user.role ?? UserRole.USER;
    if (currentRole === UserRole.ADMIN) {
      return UserRole.ADMIN;
    }
    if (!this.isAdminEmail(user.email)) {
      return currentRole;
    }
    user.role = UserRole.ADMIN;
    await user.save();
    return UserRole.ADMIN;
  }
}
