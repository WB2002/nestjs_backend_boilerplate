import Redis from 'ioredis';
import { FeatureFlagRepository } from './feature-flag.repository';
import { featureFlagIndexKey, featureFlagKey } from './feature-flag.keys';
import {
  FeatureFlagTargetingAttribute,
  FeatureFlagType,
} from './types';

function redisConnectionOptions(): { host: string; port: number } {
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
  };
}

function isRedisReachable(timeoutMs = 500): boolean {
  const { host, port } = redisConnectionOptions();
  const net = require('net') as typeof import('net');
  const socket = net.connect({ host, port });
  try {
    // Blocking probe via Atomics wait is unavailable; use sync child exit code.
  } finally {
    socket.destroy();
  }
  try {
    require('child_process').execSync(
      `node -e "const n=require('net');const s=n.connect(${port},'${host}',()=>{s.end();process.exit(0)});s.setTimeout(${timeoutMs},()=>process.exit(1));s.on('error',()=>process.exit(1))"`,
      { stdio: 'ignore', timeout: timeoutMs + 500 },
    );
    return true;
  } catch {
    return false;
  }
}

const describeWithRedis: typeof describe = isRedisReachable()
  ? describe
  : describe.skip;

describeWithRedis('FeatureFlagRepository (Redis)', () => {
  let redis: Redis;
  let repository: FeatureFlagRepository;
  const environment = `test-ff-${Date.now()}`;
  const key = 'new-checkout';

  beforeAll(async () => {
    const { host, port } = redisConnectionOptions();
    redis = new Redis({
      host,
      port,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    await redis.connect();
    repository = new FeatureFlagRepository({
      getClient: () => redis,
    } as never);
  });

  afterEach(async () => {
    await redis.del(featureFlagKey(environment, key));
    await redis.del(featureFlagIndexKey(environment));
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('creates, updates with CAS, and rejects stale versions', async () => {
    const now = new Date().toISOString();
    const created = await repository.casWrite({
      environment,
      key,
      operation: 'create',
      expectedVersion: 0,
      flagJson: JSON.stringify({
        key,
        enabled: true,
        type: FeatureFlagType.BOOLEAN,
        environment,
        createdAt: now,
        updatedAt: now,
      }),
      event: { environment, key },
    });
    expect(created.status).toBe('ok');
    expect(created.version).toBe(1);

    const updated = await repository.casWrite({
      environment,
      key,
      operation: 'update',
      expectedVersion: 1,
      flagJson: JSON.stringify({
        key,
        enabled: false,
        type: FeatureFlagType.BOOLEAN,
        environment,
        createdAt: now,
        updatedAt: now,
        version: 1,
      }),
      event: { environment, key },
    });
    expect(updated.status).toBe('ok');
    expect(updated.version).toBe(2);

    const stale = await repository.casWrite({
      environment,
      key,
      operation: 'update',
      expectedVersion: 1,
      flagJson: JSON.stringify({
        key,
        enabled: true,
        type: FeatureFlagType.BOOLEAN,
        environment,
        createdAt: now,
        updatedAt: now,
        version: 1,
      }),
      event: { environment, key },
    });
    expect(stale.status).toBe('conflict');
    expect(stale.version).toBe(2);

    const listed = await repository.loadAllFlags(environment);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.version).toBe(2);

    const deleted = await repository.casWrite({
      environment,
      key,
      operation: 'delete',
      expectedVersion: 2,
      event: { environment, key },
    });
    expect(deleted.status).toBe('ok');
    expect(await repository.getFlag(environment, key)).toBeNull();
  });

  it('stores percentage flags and loads via index (no KEYS)', async () => {
    const now = new Date().toISOString();
    const result = await repository.casWrite({
      environment,
      key,
      operation: 'create',
      expectedVersion: 0,
      flagJson: JSON.stringify({
        key,
        enabled: true,
        type: FeatureFlagType.PERCENTAGE,
        rolloutPercentage: 10,
        targeting: { attribute: FeatureFlagTargetingAttribute.USER_ID },
        environment,
        createdAt: now,
        updatedAt: now,
      }),
      event: { environment, key },
    });
    expect(result.status).toBe('ok');
    const keys = await repository.listFlagKeys(environment);
    expect(keys).toContain(key);
    const loaded = await repository.getFlag(environment, key);
    expect(loaded?.rolloutPercentage).toBe(10);
  });
});
