import { Logger } from '@nestjs/common';
import { RateLimitBackend } from '../types/rate-limit-backend.interface';
import { ConsumeContext, ConsumeResult } from '../types/rate-limit.types';

export interface FallbackRateLimitBackendOptions {
  instanceCount: number;
  cooldownMs: number;
  nowMs?: () => number;
}

export class FallbackRateLimitBackend implements RateLimitBackend {
  private readonly logger = new Logger(FallbackRateLimitBackend.name);
  private degradedUntilMs = 0;
  private readonly nowMs: () => number;
  private readonly instanceCount: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly primary: RateLimitBackend,
    private readonly fallback: RateLimitBackend,
    options: FallbackRateLimitBackendOptions,
  ) {
    this.instanceCount = Math.max(1, Math.floor(options.instanceCount || 1));
    this.cooldownMs = options.cooldownMs;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  async consume(context: ConsumeContext): Promise<ConsumeResult> {
    const nowTimestampMs = this.nowMs();
    const isDegraded = nowTimestampMs < this.degradedUntilMs;

    if (!isDegraded) {
      try {
        return await this.primary.consume(context);
      } catch (primaryError: unknown) {
        this.degradedUntilMs = nowTimestampMs + this.cooldownMs;
        const errorMessage =
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError);
        this.logger.warn(
          `Primary rate-limit backend failed, degrading to memory fallback for ${this.cooldownMs}ms: ${errorMessage}`,
        );
      }
    }

    const scaledLimit = Math.max(
      1,
      Math.floor(context.limit / this.instanceCount),
    );
    const fallbackContext: ConsumeContext = {
      ...context,
      limit: scaledLimit,
      ...(context.burst !== undefined
        ? { burst: Math.max(1, Math.floor(context.burst / this.instanceCount)) }
        : {}),
    };

    return this.fallback.consume(fallbackContext);
  }

  async quit(): Promise<void> {
    const shutdownTasks: Promise<void>[] = [];
    if (typeof this.primary.quit === 'function') {
      shutdownTasks.push(this.primary.quit());
    }
    if (typeof this.fallback.quit === 'function') {
      shutdownTasks.push(this.fallback.quit());
    }
    await Promise.all(shutdownTasks);
  }
}
