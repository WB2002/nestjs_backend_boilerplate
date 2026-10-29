import type Redis from 'ioredis';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export async function acquireRedisLoaderLock(
  redis: Pick<Redis, 'set'>,
  lockKey: string,
  token: string,
  ttlMs: number,
): Promise<boolean> {
  const ttl = Math.max(1, Math.ceil(ttlMs));
  const loadedValue = await redis.set(lockKey, token, 'PX', ttl, 'NX');
  return loadedValue === 'OK';
}

export async function releaseRedisLoaderLock(
  redis: Pick<Redis, 'eval'>,
  lockKey: string,
  token: string,
): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
}
