import { NEVER_ABORTED_SIGNAL } from './adaptive';
import { ConcurrencyLimiter } from './concurrency-limit';
import type { ConcurrencyGate } from './concurrency-gate.types';

export class FixedConcurrencyGate implements ConcurrencyGate {
  constructor(private readonly limiter: ConcurrencyLimiter) {}

  get activeCount(): number {
    return this.limiter.activeCount;
  }

  get queuedCount(): number {
    return this.limiter.queuedCount;
  }

  async run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const release = await this.limiter.acquire(signal);
    try {
      return await fn(signal ?? NEVER_ABORTED_SIGNAL);
    } finally {
      release();
    }
  }

  close(error: Error): void {
    this.limiter.close(error);
  }
}
