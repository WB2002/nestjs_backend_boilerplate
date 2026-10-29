import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { RateLimitAlgorithm } from '../enums/rate-limit-algorithm.enum';
import { RateLimitBackend } from '../types/rate-limit-backend.interface';
import { ConsumeContext, ConsumeResult } from '../types/rate-limit.types';
import { RedisLuaScriptName } from '../types/redis-lua-script.types';

export class RedisRateLimitBackend implements RateLimitBackend {
  private readonly logger = new Logger(RedisRateLimitBackend.name);
  private readonly scripts: Record<RedisLuaScriptName, string>;
  private readonly shas = new Map<RedisLuaScriptName, string>();
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly redis: Redis) {
    const luaDir = join(__dirname, 'redis', 'lua');
    this.scripts = {
      token_bucket: readFileSync(join(luaDir, 'token_bucket.lua'), 'utf8'),
      leaky_bucket: readFileSync(join(luaDir, 'leaky_bucket.lua'), 'utf8'),
      fixed_window: readFileSync(join(luaDir, 'fixed_window.lua'), 'utf8'),
      sliding_window_log: readFileSync(
        join(luaDir, 'sliding_window_log.lua'),
        'utf8',
      ),
      sliding_window_counter: readFileSync(
        join(luaDir, 'sliding_window_counter.lua'),
        'utf8',
      ),
      ewma: readFileSync(join(luaDir, 'ewma.lua'), 'utf8'),
    };
  }

  async ensureScriptsLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadScripts();
    }
    await this.loadPromise;
  }

  private async loadScripts(): Promise<void> {
    for (const [name, scriptSource] of Object.entries(this.scripts) as [
      RedisLuaScriptName,
      string,
    ][]) {
      const sha = (await this.redis.script('LOAD', scriptSource)) as string;
      this.shas.set(name, sha);
    }
  }

  private scriptSource(name: RedisLuaScriptName): string {
    switch (name) {
      case 'token_bucket':
        return this.scripts.token_bucket;
      case 'leaky_bucket':
        return this.scripts.leaky_bucket;
      case 'fixed_window':
        return this.scripts.fixed_window;
      case 'sliding_window_log':
        return this.scripts.sliding_window_log;
      case 'sliding_window_counter':
        return this.scripts.sliding_window_counter;
      case 'ewma':
        return this.scripts.ewma;
      default: {
        const _never: never = name;
        throw new Error(`Unknown Lua script: ${String(_never)}`);
      }
    }
  }

  async consume(context: ConsumeContext): Promise<ConsumeResult> {
    await this.ensureScriptsLoaded();

    const nowMs = context.nowMs;
    const burst = context.burst ?? context.limit;
    const args = [
      String(nowMs),
      String(context.limit),
      String(context.durationMs),
      String(context.cost),
    ];

    let name: RedisLuaScriptName;
    let evalArgs: string[];

    switch (context.algorithm) {
      case RateLimitAlgorithm.TokenBucket:
        name = 'token_bucket';
        evalArgs = [...args, String(burst)];
        break;
      case RateLimitAlgorithm.LeakyBucket:
        name = 'leaky_bucket';
        evalArgs = [...args, String(burst)];
        break;
      case RateLimitAlgorithm.SlidingWindowLog:
        name = 'sliding_window_log';
        evalArgs = [...args, randomUUID()];
        break;
      case RateLimitAlgorithm.SlidingWindowCounter:
        name = 'sliding_window_counter';
        evalArgs = args;
        break;
      case RateLimitAlgorithm.ExponentialWeightedMovingAverage:
        name = 'ewma';
        evalArgs = args;
        break;
      case RateLimitAlgorithm.FixedWindowCounter:
      default:
        name = 'fixed_window';
        evalArgs = args;
        break;
    }

    const raw = (await this.evalScript(name, context.key, evalArgs)) as [
      number,
      number,
      number,
      number,
    ];

    return {
      allowed: Number(raw[0]) === 1,
      remaining: Number(raw[1]),
      resetMs: Number(raw[2]),
      retryAfterMs: Number(raw[3]),
    };
  }

  private async evalScript(
    name: RedisLuaScriptName,
    key: string,
    args: string[],
  ): Promise<unknown> {
    const sha = this.shas.get(name);
    try {
      if (sha) {
        return await this.redis.evalsha(sha, 1, key, ...args);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('NOSCRIPT')) {
        throw err;
      }
      this.logger.warn(`Redis NOSCRIPT for ${name}; reloading scripts`);
      this.loadPromise = null;
      await this.ensureScriptsLoaded();
    }
    return this.redis.eval(this.scriptSource(name), 1, key, ...args);
  }

  async quit(): Promise<void> {
    await this.redis.quit();
  }
}
