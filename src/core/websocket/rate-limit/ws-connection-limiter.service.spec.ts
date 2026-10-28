import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/common/redis/redis.service';
import { WsConnectionLimiterService } from './ws-connection-limiter.service';

describe('WsConnectionLimiterService (local)', () => {
  const configService = {
    get: (key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'WEBSOCKET_REDIS_ADAPTER') return 'false';
      if (key === 'WEBSOCKET_MAX_CONNECTIONS_PER_USER') return '2';
      return undefined;
    },
  } as unknown as ConfigService;

  const redisService = {
    getClient: jest.fn(),
  } as unknown as RedisService;

  let limiter: WsConnectionLimiterService;

  beforeEach(() => {
    limiter = new WsConnectionLimiterService(configService, redisService);
  });

  it('allows connections up to max then rejects', async () => {
    await limiter.registerConnection('user-1', 's1');
    await limiter.registerConnection('user-1', 's2');
    await expect(
      limiter.registerConnection('user-1', 's3'),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('releases a slot on disconnect', async () => {
    await limiter.registerConnection('user-1', 's1');
    await limiter.registerConnection('user-1', 's2');
    await limiter.releaseConnection('user-1', 's1');
    await expect(
      limiter.registerConnection('user-1', 's3'),
    ).resolves.toBeUndefined();
  });
});
