// Adapted from @klarlabs-studio/fortify-adaptive@0.1.0 (MIT). In-repo copy — do not add npm dependency.

import { AdaptiveLimitExceededError } from './adaptive-limit-exceeded.error';
import {
  parseAdaptiveConfig,
  type AdaptiveLimiterConfig,
  type AdaptiveLimiterConfigInput,
} from './adaptive-config';
import { NEVER_ABORTED_SIGNAL } from './never-aborted-signal';

export type AdaptiveOperation<T> = (signal: AbortSignal) => Promise<T>;

export class AdaptiveLimiter<T> {
  private readonly config: AdaptiveLimiterConfig;
  private readonly clock: () => number;
  private currentLimit: number;
  private inFlightCount = 0;
  private successes = 0;
  private minRtt = 0;
  private emaRtt = 0;
  private rttSamples = 0;

  constructor(config?: AdaptiveLimiterConfigInput) {
    this.config = parseAdaptiveConfig(config);
    this.clock =
      this.config.clock ??
      (typeof performance !== 'undefined'
        ? () => performance.now()
        : () => Date.now());
    this.currentLimit = this.config.initialLimit;
  }

  limit(): number {
    return this.currentLimit;
  }

  inFlight(): number {
    return this.inFlightCount;
  }

  async execute(
    operation: AdaptiveOperation<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const sig = signal ?? NEVER_ABORTED_SIGNAL;
    if (sig.aborted) {
      throw sig.reason ?? new DOMException('Aborted', 'AbortError');
    }
    if (this.inFlightCount >= this.currentLimit) {
      throw new AdaptiveLimitExceededError();
    }
    this.inFlightCount += 1;
    const isRttAware =
      this.config.algorithm === 'vegas' ||
      this.config.algorithm === 'gradient2';
    const start = isRttAware ? this.clock() : 0;
    try {
      const operationResponse = await operation(sig);
      switch (this.config.algorithm) {
        case 'vegas':
          this.vegasOnSuccess(this.clock() - start);
          break;
        case 'gradient2':
          this.gradient2OnSuccess(this.clock() - start);
          break;
        case 'aimd':
          this.aimdOnSuccess();
          break;
        default: {
          const _never: never = this.config.algorithm;
          throw new Error(`Unknown algorithm: ${_never}`);
        }
      }
      return operationResponse;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      this.inFlightCount -= 1;
    }
  }

  getConfig(): Readonly<AdaptiveLimiterConfig> {
    return this.config;
  }

  private aimdOnSuccess(): void {
    this.successes += 1;
    if (this.successes < this.config.successThreshold) {
      return;
    }
    this.successes = 0;
    if (this.currentLimit < this.config.maxLimit) {
      this.setLimit(this.currentLimit + 1);
    }
  }

  private vegasOnSuccess(rtt: number): void {
    if (rtt <= 0) {
      return;
    }
    this.updateRttBaseline(rtt);
    this.updateEma(rtt, 1 / 8);
    this.rttSamples += 1;
    if (this.rttSamples < this.config.vegasMinSamples) {
      return;
    }
    if (this.minRtt === 0 || this.emaRtt === 0) {
      return;
    }
    const cur = this.currentLimit;
    const queue = Math.trunc((cur * (this.emaRtt - this.minRtt)) / this.emaRtt);
    if (queue < this.config.vegasAlpha) {
      if (cur < this.config.maxLimit) {
        this.setLimit(cur + 1);
      }
    } else if (queue > this.config.vegasBeta) {
      if (cur > this.config.minLimit) {
        this.setLimit(cur - 1);
      }
    }
  }

  private gradient2OnSuccess(rtt: number): void {
    if (rtt <= 0) {
      return;
    }
    this.updateRttBaseline(rtt);
    this.updateEma(rtt, this.config.gradientSmoothing);
    this.rttSamples += 1;
    if (this.rttSamples < this.config.gradientMinSamples) {
      return;
    }
    if (this.minRtt === 0 || this.emaRtt === 0) {
      return;
    }
    let gradient = this.minRtt / this.emaRtt;
    if (gradient < 0.5) {
      gradient = 0.5;
    }
    if (gradient > 1) {
      gradient = 1;
    }
    const cur = this.currentLimit;
    const queueSize = Math.sqrt(cur);
    let target = Math.floor(cur * gradient + queueSize);
    if (target < this.config.minLimit) {
      target = this.config.minLimit;
    }
    if (target > this.config.maxLimit) {
      target = this.config.maxLimit;
    }
    if (target !== cur) {
      this.setLimit(target);
    }
  }

  private onFailure(): void {
    this.successes = 0;
    const next = Math.max(
      this.config.minLimit,
      Math.floor(this.currentLimit / 2),
    );
    if (next !== this.currentLimit) {
      this.setLimit(next);
    }
  }

  private updateRttBaseline(rtt: number): void {
    if (this.minRtt === 0 || rtt < this.minRtt) {
      this.minRtt = rtt;
    }
  }

  private updateEma(rtt: number, alpha: number): void {
    if (this.emaRtt === 0) {
      this.emaRtt = rtt;
    } else {
      this.emaRtt = this.emaRtt * (1 - alpha) + rtt * alpha;
    }
  }

  private setLimit(newLimit: number): void {
    const oldLimit = this.currentLimit;
    this.currentLimit = newLimit;
    if (this.config.onLimitChange) {
      this.config.onLimitChange(oldLimit, newLimit);
    }
  }
}
