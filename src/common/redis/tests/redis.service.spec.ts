import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from '../redis.service';

jest.mock('ioredis', () => {
  const mockConstructor = jest.fn().mockImplementation(() => {
    const client = {
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
      duplicate: jest.fn().mockImplementation((overrides?: unknown) => ({
        isDuplicate: true,
        overrides,
        on: jest.fn(),
      })),
    };
    return client;
  });

  return {
    __esModule: true,
    default: mockConstructor,
  };
});

describe('RedisService', () => {
  const MockRedis = Redis as unknown as jest.Mock;
  let configService: ConfigService;

  beforeEach(() => {
    MockRedis.mockClear();
    configService = new ConfigService({
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: 6379,
    });
  });

  it('initializes the Redis client lazily when duplicate() is called before onModuleInit()', () => {
    const service = new RedisService(configService);

    const duplicated = service.duplicate({ maxRetriesPerRequest: null });

    expect(duplicated).toBeDefined();
    expect(MockRedis).toHaveBeenCalledTimes(1);
    const primaryClient = service.getClient();
    expect(primaryClient.duplicate).toHaveBeenCalledWith({
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
    });
  });

  it('reuses the lazily initialized client when onModuleInit() runs afterward', async () => {
    const service = new RedisService(configService);

    const beforeInitClient = service.getClient();
    service.onModuleInit();
    const afterInitClient = service.getClient();

    expect(afterInitClient).toBe(beforeInitClient);
    expect(MockRedis).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
    expect(beforeInitClient.quit).toHaveBeenCalledTimes(1);
  });
});
