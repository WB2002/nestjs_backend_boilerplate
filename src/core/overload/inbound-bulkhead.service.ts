import { Inject, Injectable } from '@nestjs/common';
import { INBOUND_BULKHEAD_OPTIONS } from './overload.constants';
import { InboundBulkheadConfig } from './inbound-bulkhead.types';

@Injectable()
export class InboundBulkheadService {
  private active = 0;

  constructor(
    @Inject(INBOUND_BULKHEAD_OPTIONS)
    private readonly config: InboundBulkheadConfig,
  ) {}

  get activeCount(): number {
    return this.active;
  }

  get maxInFlight(): number {
    return this.config.maxInFlight;
  }

  isEnabled(): boolean {
    return this.config.enabled;
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

  release(): void {
    if (this.active > 0) {
      this.active -= 1;
    }
  }
}
