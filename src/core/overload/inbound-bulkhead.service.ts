import { Inject, Injectable } from '@nestjs/common';
import {
  INBOUND_BULKHEAD_OPTIONS,
  INBOUND_LOAD_LEVEL_OPTIONS,
} from './overload.constants';
import { InboundBulkheadConfig } from './inbound-bulkhead.types';
import { InboundLoadLevelConfig } from './load-level/inbound-load-level.types';
import { InboundLoadLevelQueue } from './load-level/inbound-load-level-queue';
import { OverloadRejectedError } from './errors/overload-rejected.error';
import { ApiPriorityLevel } from './priority/api-priority-level.enum';

@Injectable()
export class InboundBulkheadService {
  private active = 0;
  private readonly queue: InboundLoadLevelQueue;

  constructor(
    @Inject(INBOUND_BULKHEAD_OPTIONS)
    private readonly config: InboundBulkheadConfig,
    @Inject(INBOUND_LOAD_LEVEL_OPTIONS)
    private readonly loadLevelConfig: InboundLoadLevelConfig,
  ) {
    this.queue = new InboundLoadLevelQueue(
      this.loadLevelConfig.maxQueue,
      this.loadLevelConfig.pollIntervalMs,
    );
  }

  get activeCount(): number {
    return this.active;
  }

  get maxInFlight(): number {
    return this.config.maxInFlight;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isLoadLevelingEnabled(): boolean {
    return this.config.enabled && this.loadLevelConfig.enabled;
  }

  /** Fail-fast: no queue when at capacity. */
  tryAcquire(): boolean {
    if (!this.config.enabled) {
      return true;
    }
    if (this.active >= this.config.maxInFlight) {
      return false;
    }
    this.active += 1;
    return true;
  }

  async acquire(options: {
    priority: ApiPriorityLevel;
    maxWaitMs?: number;
    signal?: AbortSignal;
  }): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    if (this.tryAcquire()) {
      return;
    }
    if (!this.loadLevelConfig.enabled) {
      throw new OverloadRejectedError();
    }
    await this.queue.enqueue({
      priority: options.priority,
      maxWaitMs: options.maxWaitMs ?? this.loadLevelConfig.maxWaitMs,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  }

  release(): void {
    if (!this.config.enabled) {
      return;
    }
    if (this.active > 0) {
      this.active -= 1;
    }
    if (!this.loadLevelConfig.enabled) {
      return;
    }
    const grant = this.queue.dequeueNextWaiter();
    if (grant) {
      this.active += 1;
      grant();
    }
  }
}
