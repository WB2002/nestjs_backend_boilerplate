import type { RedisOptions } from 'ioredis';

/** BullMQ requires maxRetriesPerRequest: null on ioredis connections. */
export function createBullMqDuplicateOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  };
}
