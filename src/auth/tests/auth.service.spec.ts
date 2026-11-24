import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import { AuthService } from '../auth.service';
import { PasswordHashBulkhead } from '../password/password-hash-bulkhead';
import { RedisService } from '@/common/redis/redis.service';
import { CacheService } from '@/core/cache';
import { User, Session } from '../schemas';
import { OverloadRejectedError } from '@/core/overload';

jest.mock('argon2', () => ({
  argon2id: 2,
  hash: jest.fn().mockResolvedValue('mocked-hash'),
  verify: jest.fn().mockResolvedValue(true),
}));

describe('AuthService with PasswordHashBulkhead', () => {
  let authService: AuthService;
  let userModel: Partial<Model<User>>;
  let sessionModel: Partial<Model<Session>>;
  let jwtService: Partial<JwtService>;
  let configService: Partial<ConfigService>;
  let redisService: Partial<RedisService>;
  let bulkhead: PasswordHashBulkhead;
  let saveMock: jest.Mock;

  beforeEach(() => {
    saveMock = jest.fn();
    userModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    };
    sessionModel = {};
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('mock-token'),
    };
    configService = {
      get: jest.fn().mockReturnValue(undefined),
    };
    redisService = {
      getClient: jest.fn().mockReturnValue({}),
    };
    bulkhead = new PasswordHashBulkhead(undefined, {
      maxConcurrent: 2,
      maxQueue: 10,
      maxWaitMs: 2000,
    });

    const UserModelConstructor = function (
      this: unknown,
      doc: Record<string, unknown>,
    ) {
      saveMock.mockResolvedValueOnce(doc);
      Object.assign(this as object, doc, {
        save: saveMock,
      });
    } as unknown as Model<User>;
    UserModelConstructor.findOne = (
      ...args: Parameters<typeof userModel.findOne>
    ) => userModel.findOne?.(...args) as ReturnType<typeof userModel.findOne>;

    const cacheService = {
      getOrSet: jest.fn(async (_key: string, loader: () => Promise<unknown>) =>
        loader(),
      ),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;

    authService = new AuthService(
      UserModelConstructor,
      sessionModel as Model<Session>,
      jwtService as JwtService,
      configService as ConfigService,
      redisService as RedisService,
      bulkhead,
      cacheService,
    );
  });

  it('runs password hashing through the bulkhead on register', async () => {
    const runSpy = jest.spyOn(bulkhead, 'run');

    await authService.register({
      email: 'test@example.com',
      password: 'secure-password',
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(argon2.hash).toHaveBeenCalledWith(
      'secure-password',
      expect.objectContaining({
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
    );
  });

  it('allows overriding Argon2id parameters via config env vars', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'ARGON2_MEMORY_COST_KIB') return '32768';
      if (key === 'ARGON2_TIME_COST') return '3';
      if (key === 'ARGON2_PARALLELISM') return '2';
      return undefined;
    });

    await authService.register({
      email: 'custom@example.com',
      password: 'secure-password',
    });

    expect(argon2.hash).toHaveBeenCalledWith(
      'secure-password',
      expect.objectContaining({
        type: argon2.argon2id,
        memoryCost: 32_768,
        timeCost: 3,
        parallelism: 2,
      }),
    );
  });

  it('runs password verification through the bulkhead on validateUser', async () => {
    const runSpy = jest.spyOn(bulkhead, 'run');
    userModel.findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        isActive: true,
        passwordHash: 'hashed',
        toObject: () => ({
          id: '1',
          email: 'test@example.com',
          passwordHash: 'hashed',
        }),
      }),
    });

    const user = await authService.validateUser(
      'test@example.com',
      'password123',
    );

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(argon2.verify).toHaveBeenCalledWith('hashed', 'password123');
    expect(user).toEqual({ id: '1', email: 'test@example.com' });
  });

  it('propagates OverloadRejectedError when bulkhead capacity is exceeded', async () => {
    jest
      .spyOn(bulkhead, 'run')
      .mockRejectedValue(
        new OverloadRejectedError('Password hashing capacity exceeded'),
      );

    await expect(
      authService.register({
        email: 'test2@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(OverloadRejectedError);
  });

  it('translates concurrent MongoDB E11000 duplicate key error on save into ConflictException', async () => {
    saveMock.mockReset();
    saveMock.mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }),
    );

    await expect(
      authService.register({
        email: 'race@example.com',
        password: 'Password123!',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
