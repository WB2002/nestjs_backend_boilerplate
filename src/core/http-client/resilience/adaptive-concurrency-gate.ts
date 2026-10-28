import {
  AdaptiveLimiter,
  type AdaptiveLimiterConfigInput,
} from './adaptive';
import type { ConcurrencyGate } from './concurrency-gate.types';
import { mergeAbortSignals } from './merge-abort-signals';

export class AdaptiveConcurrencyGate implements ConcurrencyGate {
  private readonly limiter: AdaptiveLimiter<unknown>;

  constructor(config: AdaptiveLimiterConfigInput) {
    this.limiter = new AdaptiveLimiter(config);
  }

  get activeCount(): number {
    return this.limiter.inFlight();
  }

  get queuedCount(): number {
    return 0;
  }

  async run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const result = await this.limiter.execute(async (slotSignal) => {
      const merged = mergeAbortSignals(signal, slotSignal);
      return fn(merged);
    }, signal);
    return result as T;
  }

  close(_error: Error): void {
    // AdaptiveLimiter has no close; ClientRuntime.closed stops new work.
  }
}
