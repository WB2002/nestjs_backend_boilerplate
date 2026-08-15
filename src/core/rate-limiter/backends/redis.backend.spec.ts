import Redis from 'ioredis';
import { RedisRateLimitBackend } from './redis.backend';
import { allSharedScenarios, runScenario } from './algorithm-scenarios';
import {
  createRedisBackend,
  describeWithRedis,
  scenarioKey,
  testKeyPrefix,
  tryConnectRedis,
} from './redis-test-utils';

describeWithRedis('RedisRateLimitBackend', () => {
  let redis: Redis;
  let backend: RedisRateLimitBackend;
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
    backend = await createRedisBackend(redis);
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
    await backend.quit();
  });

  it.each(allSharedScenarios())('$name', async (scenario) => {
    const key = scenarioKey(keyPrefix, scenario.name);
    keysUsed.push(key);
    await runScenario(backend, scenario, key);
  });
});
