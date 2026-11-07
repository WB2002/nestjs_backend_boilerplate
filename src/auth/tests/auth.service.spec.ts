import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import { AuthService } from '../auth.service';
import { PasswordHashBulkhead } from '../password/password-hash-bulkhead';
import { RedisService } from '@/common/redis/redis.service';
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

  beforeEach(() => {
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
      Object.assign(this as object, doc, {
        save: jest.fn().mockResolvedValue(doc),
      });
    } as unknown as Model<User>;
    UserModelConstructor.findOne = (
      ...args: Parameters<typeof userModel.findOne>
    ) => userModel.findOne?.(...args) as ReturnType<typeof userModel.findOne>;

    authService = new AuthService(
      UserModelConstructor,
      sessionModel as Model<Session>,
      jwtService as JwtService,
      configService as ConfigService,
      redisService as RedisService,
      bulkhead,
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
        memoryCost: 64 * 1024,
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
});
