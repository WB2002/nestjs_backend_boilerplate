import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/common/redis/redis.service';
import { parseWebSocketConfig } from '../config/parse-websocket-config';

const CONNECTION_ALIVE_PREFIX = 'ws:conn:alive:';
const CONNECTION_COUNT_PREFIX = 'ws:conn:count:';
const REDIS_PRUNE_BATCH = 50;
const REDIS_PRUNE_INTERVAL_MS = 60_000;

@Injectable()
export class WsConnectionLimiterService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly localConnections = new Map<string, Set<string>>();
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit(): void {
    const config = parseWebSocketConfig(this.configService);
    if (!config.redisAdapterEnabled) {
      return;
    }
    this.pruneTimer = setInterval(
      () => void this.pruneStaleAliveKeys(),
      REDIS_PRUNE_INTERVAL_MS,
    );
    if (this.pruneTimer && typeof this.pruneTimer.unref === 'function') {
      this.pruneTimer.unref();
    }
  }

  private aliveKey(userId: string, socketId: string): string {
    return `${CONNECTION_ALIVE_PREFIX}${userId}:${socketId}`;
  }

  private countKey(userId: string): string {
    return `${CONNECTION_COUNT_PREFIX}${userId}`;
  }

  private async pruneStaleAliveKeys(): Promise<void> {
    const client = this.redisService.getClient();
    let cursor = '0';
    let scanned = 0;
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        'MATCH',
        `${CONNECTION_ALIVE_PREFIX}*`,
        'COUNT',
        REDIS_PRUNE_BATCH,
      );
      cursor = nextCursor;
      for (const key of keys) {
        const ttl = await client.ttl(key);
        if (ttl === -2) {
          const suffix = key.slice(CONNECTION_ALIVE_PREFIX.length);
          const sep = suffix.lastIndexOf(':');
          if (sep > 0) {
            const userId = suffix.slice(0, sep);
            await client.decr(this.countKey(userId));
          }
        }
      }
      scanned += keys.length;
    } while (cursor !== '0' && scanned < REDIS_PRUNE_BATCH * 10);
  }

  async registerConnection(userId: string, socketId: string): Promise<void> {
    const config = parseWebSocketConfig(this.configService);
    const max = config.maxConnectionsPerUser;

    if (config.redisAdapterEnabled) {
      const client = this.redisService.getClient();
      const countKey = this.countKey(userId);
      const aliveKey = this.aliveKey(userId, socketId);
      const count = await client.incr(countKey);
      await client.expire(countKey, config.connectionKeyTtlSec);
      await client.set(aliveKey, '1', 'EX', config.connectionKeyTtlSec);
      if (count > max) {
        await client.decr(countKey);
        await client.del(aliveKey);
        throw new HttpException(
          'WebSocket connection limit exceeded',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return;
    }

    let sockets = this.localConnections.get(userId);
    if (!sockets) {
      sockets = new Set<string>();
      this.localConnections.set(userId, sockets);
    }
    if (sockets.size >= max) {
      throw new HttpException(
        'WebSocket connection limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    sockets.add(socketId);
  }

  async releaseConnection(userId: string, socketId: string): Promise<void> {
    const config = parseWebSocketConfig(this.configService);
    if (config.redisAdapterEnabled) {
      const client = this.redisService.getClient();
      await client.del(this.aliveKey(userId, socketId));
      const remaining = await client.decr(this.countKey(userId));
      if (remaining <= 0) {
        await client.del(this.countKey(userId));
      }
      return;
    }

    const sockets = this.localConnections.get(userId);
    if (!sockets) {
      return;
    }
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.localConnections.delete(userId);
    }
  }

  onModuleDestroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.localConnections.clear();
  }
}
