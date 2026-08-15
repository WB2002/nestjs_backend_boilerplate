import Redis from 'ioredis';
import { MemoryRateLimitBackend } from './memory.backend';
import { RedisRateLimitBackend } from './redis.backend';
import { allSharedScenarios, runParityScenario } from './algorithm-scenarios';
import {
  createRedisBackend,
  describeWithRedis,
  scenarioKey,
  testKeyPrefix,
  tryConnectRedis,
} from './redis-test-utils';

describeWithRedis('Memory ↔ Redis backend parity', () => {
  let redis: Redis;
  let redisBackend: RedisRateLimitBackend;
  let keyPrefix = '';
  const keysUsed: string[] = [];

  beforeAll(async () => {
    const conn = await tryConnectRedis();
    if (!conn) {
      throw new Error(
        'Redis was reachable at suite load but failed to connect in beforeAll',
      );
    }
    redis = conn;
    redisBackend = await createRedisBackend(redis);
    keyPrefix = testKeyPrefix();
  });

  afterEach(async () => {
    if (keysUsed.length === 0) {
      return;
    }
    await redis.del(...keysUsed);
    keysUsed.length = 0;
  });

  afterAll(async () => {
    await redisBackend.quit();
  });

  it.each(allSharedScenarios())('$name', async (scenario) => {
    const memory = new MemoryRateLimitBackend();
    const memKey = scenarioKey(keyPrefix, `mem:${scenario.name}`);
    const redisKey = scenarioKey(keyPrefix, `redis:${scenario.name}`);
    keysUsed.push(redisKey);

    await runParityScenario(
      memory,
      redisBackend,
      scenario,
      memKey,
      redisKey,
    );
  });
});
