import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/common/redis/redis.service';
import { parseWebSocketConfig } from '../config/parse-websocket-config';
import { AuthenticatedSocket } from '../types/authenticated-socket.types';

const MESSAGE_KEY_PREFIX = 'ws:msg:';
const MESSAGE_WINDOW_SEC = 60;
const LOCAL_COUNTER_SWEEP_MS = 60_000;

@Injectable()
export class WsMessageRateLimiterGuard
  implements CanActivate, OnModuleInit, OnModuleDestroy
{
  private readonly localCounts = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(
      () => this.sweepExpiredLocalCounters(),
      LOCAL_COUNTER_SWEEP_MS,
    );
    if (this.sweepTimer && typeof this.sweepTimer.unref === 'function') {
      this.sweepTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.localCounts.clear();
  }

  releaseLocalCounter(userId: string): void {
    this.localCounts.delete(userId);
  }

  private sweepExpiredLocalCounters(): void {
    const now = Date.now();
    for (const [userId, entry] of this.localCounts) {
      if (entry.resetAt <= now) {
        this.localCounts.delete(userId);
      }
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'ws') {
      return true;
    }

    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    if (!client.data.wsConnectionRegistered) {
      return true;
    }

    const user = client.data.user;
    if (!user) {
      return true;
    }

    const config = parseWebSocketConfig(this.configService);
    const isAllowed = config.redisAdapterEnabled
      ? await this.checkRedis(user.id, config.messagesPerMinute)
      : this.checkLocal(user.id, config.messagesPerMinute);

    if (!isAllowed) {
      throw new HttpException(
        'WebSocket message rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private checkLocal(userId: string, limit: number): boolean {
    const now = Date.now();
    const entry = this.localCounts.get(userId);
    if (!entry || entry.resetAt <= now) {
      this.localCounts.set(userId, {
        count: 1,
        resetAt: now + MESSAGE_WINDOW_SEC * 1000,
      });
      return true;
    }

    entry.count += 1;
    return entry.count <= limit;
  }

  private async checkRedis(userId: string, limit: number): Promise<boolean> {
    const key = `${MESSAGE_KEY_PREFIX}${userId}`;
    const client = this.redisService.getClient();
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, MESSAGE_WINDOW_SEC);
    }
    return count <= limit;
  }
}
