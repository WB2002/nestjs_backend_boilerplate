import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Max time to wait for a graceful QUIT before dropping the socket. */
const QUIT_TIMEOUT_MS = 1_000;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client?: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }

    let quitTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.client.quit(),
        new Promise((_, reject) => {
          quitTimer = setTimeout(
            () => reject(new Error('redis quit timeout')),
            QUIT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      // Unreachable or slow Redis: drop the socket without reconnecting.
      this.client.disconnect(false);
    } finally {
      clearTimeout(quitTimer);
    }
  }

  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client is not initialized');
    }
    return this.client;
  }
}
