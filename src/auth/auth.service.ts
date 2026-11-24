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
import { CacheService } from '@/core/cache';
import type { CacheTtl } from '@/core/cache/types/cache.types';

const DEFAULT_ARGON2_MEMORY_COST_KIB = 19_456;
const MIN_ARGON2_MEMORY_COST_KIB = 12_288;
const DEFAULT_ARGON2_TIME_COST = 2;
const MIN_ARGON2_TIME_COST = 2;
const DEFAULT_ARGON2_PARALLELISM = 1;
const MIN_ARGON2_PARALLELISM = 1;

@Injectable()
export class AuthService {
  private cachedAdminEmailsRaw: string | undefined;
  private cachedAdminEmailsSet: ReadonlySet<string> = new Set();

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Session.name) private sessionModel: Model<Session>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redisService: RedisService,
    private passwordHashBulkhead: PasswordHashBulkhead,
    private readonly cacheService: CacheService,
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

    const argon2Options = this.resolveArgon2HashOptions();
    const passwordHash = await this.passwordHashBulkhead.run(() =>
      argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: argon2Options.memoryCost,
        timeCost: argon2Options.timeCost,
        parallelism: argon2Options.parallelism,
      }),
    );

    const newUser = new this.userModel({
      email,
      passwordHash,
      role: this.resolveRoleForEmail(email),
    });

    try {
      await newUser.save();
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 11000
      ) {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
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
    await this.invalidateRoleCache(userId);

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
    await this.invalidateRoleCache(user.id);

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
      await Promise.all([
        this.cacheService.delete(`auth:revoked:${sessionId}`),
        this.cacheService.set(`auth:revoked:${sessionId}`, true, {
          softTtlMs: accessTokenTtl * 1000,
          hardTtlMs: accessTokenTtl * 1000,
        }),
        this.cacheService.delete(`auth:role:${session.userId}`),
      ]);
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    const ttl = this.authHotPathCacheTtl();
    return this.cacheService.getOrSet(
      `auth:revoked:${jti}`,
      async () => {
        const tokenPair = await this.redis.get(`revoked_jti:${jti}`);
        return !!tokenPair;
      },
      { ttl, cacheNull: true },
    );
  }

  async resolveAuthoritativeRoleForUserId(userId: string): Promise<UserRole> {
    const ttl = this.authHotPathCacheTtl();
    return this.cacheService.getOrSet(
      `auth:role:${userId}`,
      async () => this.loadPersistedUserRole(userId),
      { ttl },
    );
  }

  invalidateRoleCache(userId: string): Promise<void> {
    return this.cacheService.delete(`auth:role:${userId}`);
  }

  private async loadPersistedUserRole(userId: string): Promise<UserRole> {
    const user = await this.userModel.findById(userId).exec();
    if (!user?.isActive) {
      throw new UnauthorizedException('User not found');
    }
    return user.role ?? UserRole.USER;
  }

  private authHotPathCacheTtl(): CacheTtl {
    const ttlSec = this.configService.get<number>(
      'AUTH_HOT_PATH_CACHE_TTL_SEC',
      5,
    );
    const softTtlMs = Math.max(1, ttlSec) * 1000;
    return { softTtlMs, hardTtlMs: softTtlMs * 2 };
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

  private resolveArgon2HashOptions(): {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  } {
    return {
      memoryCost: this.parseBoundedPositiveInt(
        'ARGON2_MEMORY_COST_KIB',
        DEFAULT_ARGON2_MEMORY_COST_KIB,
        MIN_ARGON2_MEMORY_COST_KIB,
      ),
      timeCost: this.parseBoundedPositiveInt(
        'ARGON2_TIME_COST',
        DEFAULT_ARGON2_TIME_COST,
        MIN_ARGON2_TIME_COST,
      ),
      parallelism: this.parseBoundedPositiveInt(
        'ARGON2_PARALLELISM',
        DEFAULT_ARGON2_PARALLELISM,
        MIN_ARGON2_PARALLELISM,
      ),
    };
  }

  private parseBoundedPositiveInt(
    envKey: string,
    defaultValue: number,
    minValue: number,
  ): number {
    const raw = this.configService.get<string | number>(envKey);
    if (raw == null || raw === '') {
      return defaultValue;
    }
    const parsed =
      typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed) || parsed < minValue) {
      return defaultValue;
    }
    return Math.floor(parsed);
  }

  private isAdminEmail(email: string): boolean {
    const raw = this.configService.get<string>('FEATURE_FLAG_ADMIN_EMAILS', '');
    if (!raw) {
      return false;
    }
    if (raw !== this.cachedAdminEmailsRaw) {
      this.cachedAdminEmailsRaw = raw;
      this.cachedAdminEmailsSet = new Set(
        raw
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      );
    }
    return this.cachedAdminEmailsSet.has(email.trim().toLowerCase());
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
