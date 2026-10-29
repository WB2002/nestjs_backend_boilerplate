import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/common/redis/redis.service';
import { parseWebSocketConfig } from '../config/parse-websocket-config';

const CONNECTION_KEY_PREFIX = 'ws:conn:';
const CONNECTION_ALIVE_PREFIX = 'ws:conn:alive:';

@Injectable()
export class WsConnectionLimiterService implements OnModuleDestroy {
  private readonly localConnections = new Map<string, Set<string>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  private aliveKey(userId: string, socketId: string): string {
    return `${CONNECTION_ALIVE_PREFIX}${userId}:${socketId}`;
  }

  private async pruneStaleRedisConnections(
    userId: string,
    setKey: string,
  ): Promise<void> {
    const client = this.redisService.getClient();
    const members = await client.smembers(setKey);
    if (members.length === 0) {
      return;
    }
    const pipeline = client.pipeline();
    for (const socketId of members) {
      pipeline.exists(this.aliveKey(userId, socketId));
    }
    const existsResults = await pipeline.exec();
    if (!existsResults) {
      return;
    }
    await Promise.all(
      existsResults.map(async (existsResult, memberIndex) => {
        const socketId = members.at(memberIndex);
        const isAliveKeyPresent = existsResult?.[1] === 1;
        if (!isAliveKeyPresent && socketId) {
          await client.srem(setKey, socketId);
        }
      }),
    );
  }

  async registerConnection(userId: string, socketId: string): Promise<void> {
    const config = parseWebSocketConfig(this.configService);
    const max = config.maxConnectionsPerUser;

    if (config.redisAdapterEnabled) {
      const setKey = `${CONNECTION_KEY_PREFIX}${userId}`;
      const client = this.redisService.getClient();
      await this.pruneStaleRedisConnections(userId, setKey);
      await client.sadd(setKey, socketId);
      await client.set(
        this.aliveKey(userId, socketId),
        '1',
        'EX',
        config.connectionKeyTtlSec,
      );
      await client.expire(setKey, config.connectionKeyTtlSec);
      const count = await client.scard(setKey);
      if (count > max) {
        await client.srem(setKey, socketId);
        await client.del(this.aliveKey(userId, socketId));
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
      const setKey = `${CONNECTION_KEY_PREFIX}${userId}`;
      const client = this.redisService.getClient();
      await client.srem(setKey, socketId);
      await client.del(this.aliveKey(userId, socketId));
      const remaining = await client.scard(setKey);
      if (remaining === 0) {
        await client.del(setKey);
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
    this.localConnections.clear();
  }
}
