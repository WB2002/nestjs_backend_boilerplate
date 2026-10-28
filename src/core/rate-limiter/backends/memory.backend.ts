import { RateLimitAlgorithm } from '../enums/rate-limit-algorithm.enum';
import { RateLimitBackend } from '../types/rate-limit-backend.interface';
import { ConsumeContext, ConsumeResult } from '../types/rate-limit.types';
import {
  MEMORY_BACKEND_MAX_KEYS,
  MEMORY_EVICT_RATIO,
  MEMORY_KEY_TTL_MULTIPLIER,
} from '../constants/rate-limit.constants';
import {
  EwmaState,
  FixedWindowState,
  LeakyBucketState,
  MemoryKeyMeta,
  MemoryStoreName,
  SlidingCounterState,
  SlidingLogEntry,
  TokenBucketState,
} from '../types/memory-backend.types';

export class MemoryRateLimitBackend implements RateLimitBackend {
  private readonly tokenBuckets = new Map<string, TokenBucketState>();
  private readonly leakyBuckets = new Map<string, LeakyBucketState>();
  private readonly fixedWindows = new Map<string, FixedWindowState>();
  private readonly slidingLogs = new Map<string, SlidingLogEntry[]>();
  private readonly slidingCounters = new Map<string, SlidingCounterState>();
  private readonly ewmas = new Map<string, EwmaState>();
  private readonly meta = new Map<string, MemoryKeyMeta>();
  private readonly maxKeys: number;

  constructor(maxKeys = MEMORY_BACKEND_MAX_KEYS) {
    this.maxKeys = maxKeys;
  }

  async consume(context: ConsumeContext): Promise<ConsumeResult> {
    this.evictExpired(context.nowMs);
    this.enforceCap();

    switch (context.algorithm) {
      case RateLimitAlgorithm.TokenBucket:
        return this.tokenBucket(context);
      case RateLimitAlgorithm.LeakyBucket:
        return this.leakyBucket(context);
      case RateLimitAlgorithm.FixedWindowCounter:
        return this.fixedWindow(context);
      case RateLimitAlgorithm.SlidingWindowLog:
        return this.slidingWindowLog(context);
      case RateLimitAlgorithm.SlidingWindowCounter:
        return this.slidingWindowCounter(context);
      case RateLimitAlgorithm.ExponentialWeightedMovingAverage:
        return this.ewma(context);
      default:
        return this.fixedWindow(context);
    }
  }

  /** Exposed for tests. */
  get size(): number {
    return this.meta.size;
  }

  private touch(key: string, store: MemoryStoreName, ctx: ConsumeContext): void {
    this.meta.set(key, {
      expiresAt: ctx.nowMs + ctx.durationMs * MEMORY_KEY_TTL_MULTIPLIER,
      lastAccess: ctx.nowMs,
      store,
    });
  }

  private evictExpired(nowMs: number): void {
    for (const [key, info] of this.meta) {
      if (info.expiresAt <= nowMs) {
        this.deleteKey(key, info.store);
      }
    }
  }

  private enforceCap(): void {
    if (this.meta.size < this.maxKeys) {
      return;
    }
    const sorted = [...this.meta.entries()].sort(
      (a, b) => a[1].lastAccess - b[1].lastAccess,
    );
    const toRemove = Math.max(1, Math.floor(this.maxKeys * MEMORY_EVICT_RATIO));
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      const entry = sorted[i];
      if (entry === undefined) {
        continue;
      }
      const [key, info] = entry;
      this.deleteKey(key, info.store);
    }
  }

  private deleteKey(key: string, store: MemoryStoreName): void {
    this.meta.delete(key);
    this[store].delete(key);
  }

  private tokenBucket(ctx: ConsumeContext): ConsumeResult {
    const capacity = ctx.burst ?? ctx.limit;
    const refillPerMs = ctx.limit / ctx.durationMs;
    let state = this.tokenBuckets.get(ctx.key);
    if (!state) {
      state = { tokens: capacity, lastRefillAt: ctx.nowMs };
      this.tokenBuckets.set(ctx.key, state);
    }
    this.touch(ctx.key, 'tokenBuckets', ctx);

    const elapsed = Math.max(0, ctx.nowMs - state.lastRefillAt);
    state.tokens = Math.min(capacity, state.tokens + elapsed * refillPerMs);
    state.lastRefillAt = ctx.nowMs;

    if (state.tokens < ctx.cost) {
      const deficit = ctx.cost - state.tokens;
      const retryAfterMs = refillPerMs > 0 ? Math.ceil(deficit / refillPerMs) : ctx.durationMs;
      const resetMs =
        refillPerMs > 0 ? Math.ceil((capacity - state.tokens) / refillPerMs) : ctx.durationMs;
      return {
        allowed: false,
        remaining: Math.floor(state.tokens),
        resetMs,
        retryAfterMs,
      };
    }

    state.tokens -= ctx.cost;
    const resetMs =
      refillPerMs > 0 ? Math.ceil((capacity - state.tokens) / refillPerMs) : ctx.durationMs;
    return {
      allowed: true,
      remaining: Math.floor(state.tokens),
      resetMs,
      retryAfterMs: 0,
    };
  }

  private leakyBucket(ctx: ConsumeContext): ConsumeResult {
    const capacity = ctx.burst ?? ctx.limit;
    const leakPerMs = ctx.limit / ctx.durationMs;
    let state = this.leakyBuckets.get(ctx.key);
    if (!state) {
      state = { level: 0, lastLeakAt: ctx.nowMs };
      this.leakyBuckets.set(ctx.key, state);
    }
    this.touch(ctx.key, 'leakyBuckets', ctx);

    const elapsed = Math.max(0, ctx.nowMs - state.lastLeakAt);
    state.level = Math.max(0, state.level - elapsed * leakPerMs);
    state.lastLeakAt = ctx.nowMs;

    if (state.level + ctx.cost > capacity) {
      const overflow = state.level + ctx.cost - capacity;
      const retryAfterMs = leakPerMs > 0 ? Math.ceil(overflow / leakPerMs) : ctx.durationMs;
      const resetMs = leakPerMs > 0 ? Math.ceil(state.level / leakPerMs) : ctx.durationMs;
      return {
        allowed: false,
        remaining: Math.max(0, Math.floor(capacity - state.level)),
        resetMs,
        retryAfterMs,
      };
    }

    state.level += ctx.cost;
    const resetMs = leakPerMs > 0 ? Math.ceil(state.level / leakPerMs) : ctx.durationMs;
    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(capacity - state.level)),
      resetMs,
      retryAfterMs: 0,
    };
  }

  private fixedWindow(ctx: ConsumeContext): ConsumeResult {
    let state = this.fixedWindows.get(ctx.key);
    if (!state || ctx.nowMs >= state.windowStart + ctx.durationMs) {
      state = { windowStart: ctx.nowMs, count: 0 };
      this.fixedWindows.set(ctx.key, state);
    }
    this.touch(ctx.key, 'fixedWindows', ctx);

    const resetMs = Math.max(0, state.windowStart + ctx.durationMs - ctx.nowMs);

    if (state.count + ctx.cost > ctx.limit) {
      return {
        allowed: false,
        remaining: Math.max(0, ctx.limit - state.count),
        resetMs,
        retryAfterMs: resetMs,
      };
    }

    state.count += ctx.cost;
    return {
      allowed: true,
      remaining: Math.max(0, ctx.limit - state.count),
      resetMs,
      retryAfterMs: 0,
    };
  }

  private slidingWindowLog(ctx: ConsumeContext): ConsumeResult {
    const cutoff = ctx.nowMs - ctx.durationMs;
    let entries = this.slidingLogs.get(ctx.key) ?? [];
    entries = entries.filter((e) => e.ts > cutoff);

    const used = entries.reduce((sum, e) => sum + e.cost, 0);
    if (used + ctx.cost > ctx.limit) {
      const oldest = entries[0];
      const retryAfterMs = oldest
        ? Math.max(0, oldest.ts + ctx.durationMs - ctx.nowMs)
        : ctx.durationMs;
      this.slidingLogs.set(ctx.key, entries);
      this.touch(ctx.key, 'slidingLogs', ctx);
      return {
        allowed: false,
        remaining: Math.max(0, ctx.limit - used),
        resetMs: retryAfterMs,
        retryAfterMs,
      };
    }

    entries.push({ ts: ctx.nowMs, cost: ctx.cost });
    this.slidingLogs.set(ctx.key, entries);
    this.touch(ctx.key, 'slidingLogs', ctx);
    const newUsed = used + ctx.cost;
    const oldest = entries[0];
    const resetMs = oldest ? Math.max(0, oldest.ts + ctx.durationMs - ctx.nowMs) : ctx.durationMs;
    return {
      allowed: true,
      remaining: Math.max(0, ctx.limit - newUsed),
      resetMs,
      retryAfterMs: 0,
    };
  }

  private slidingWindowCounter(ctx: ConsumeContext): ConsumeResult {
    let state = this.slidingCounters.get(ctx.key);
    if (!state) {
      state = { windowStart: ctx.nowMs, previousCount: 0, currentCount: 0 };
      this.slidingCounters.set(ctx.key, state);
    }
    this.touch(ctx.key, 'slidingCounters', ctx);

    while (ctx.nowMs >= state.windowStart + ctx.durationMs) {
      state.previousCount = state.currentCount;
      state.currentCount = 0;
      state.windowStart += ctx.durationMs;
      if (ctx.nowMs >= state.windowStart + ctx.durationMs * 2) {
        state.previousCount = 0;
        state.currentCount = 0;
        state.windowStart = ctx.nowMs;
        break;
      }
    }

    const elapsed = ctx.nowMs - state.windowStart;
    const weight = 1 - elapsed / ctx.durationMs;
    const estimate = state.previousCount * weight + state.currentCount;
    const resetMs = Math.max(0, state.windowStart + ctx.durationMs - ctx.nowMs);

    if (estimate + ctx.cost > ctx.limit) {
      return {
        allowed: false,
        remaining: Math.max(0, Math.floor(ctx.limit - estimate)),
        resetMs,
        retryAfterMs: resetMs,
      };
    }

    state.currentCount += ctx.cost;
    const newEstimate = state.previousCount * weight + state.currentCount;
    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(ctx.limit - newEstimate)),
      resetMs,
      retryAfterMs: 0,
    };
  }

  private ewma(ctx: ConsumeContext): ConsumeResult {
    let state = this.ewmas.get(ctx.key);
    if (!state) {
      state = { ewma: 0, lastAt: ctx.nowMs };
      this.ewmas.set(ctx.key, state);
    }
    this.touch(ctx.key, 'ewmas', ctx);

    const dt = Math.max(0, ctx.nowMs - state.lastAt);
    const decay = Math.exp(-dt / ctx.durationMs);
    const projected = state.ewma * decay + ctx.cost;

    if (projected > ctx.limit) {
      let retryAfterMs = ctx.durationMs;
      if (state.ewma > 0 && ctx.cost <= ctx.limit) {
        const target = (ctx.limit - ctx.cost) / state.ewma;
        if (target > 0) {
          retryAfterMs = Math.ceil(-ctx.durationMs * Math.log(target));
        }
      }
      state.lastAt = ctx.nowMs;
      return {
        allowed: false,
        remaining: Math.max(0, Math.floor(ctx.limit - state.ewma * decay)),
        resetMs: retryAfterMs,
        retryAfterMs,
      };
    }

    state.ewma = projected;
    state.lastAt = ctx.nowMs;
    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(ctx.limit - state.ewma)),
      resetMs: ctx.durationMs,
      retryAfterMs: 0,
    };
  }
}
