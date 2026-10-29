import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { InboundBulkheadConfig } from '../inbound-bulkhead.types';
import { InboundLoadLevelConfig } from '../load-level/inbound-load-level.types';

const disabledLoadLevel: InboundLoadLevelConfig = {
  enabled: false,
  maxQueue: 100,
  maxWaitMs: 2_000,
  pollIntervalMs: 25,
};

describe('InboundBulkheadService', () => {
  function createService(
    config: InboundBulkheadConfig,
  ): InboundBulkheadService {
    return new InboundBulkheadService(config, disabledLoadLevel);
  }

  it('passes through when disabled', () => {
    const service = createService({ enabled: false, maxInFlight: 1 });
    expect(service.tryAcquire()).toBe(true);
    expect(service.tryAcquire()).toBe(true);
    expect(service.activeCount).toBe(0);
  });

  it('fail-fast at maxInFlight with no queue', () => {
    const service = createService({ enabled: true, maxInFlight: 2 });
    expect(service.tryAcquire()).toBe(true);
    expect(service.tryAcquire()).toBe(true);
    expect(service.tryAcquire()).toBe(false);
    service.release();
    expect(service.tryAcquire()).toBe(true);
    expect(service.activeCount).toBe(2);
    service.release();
    service.release();
    expect(service.activeCount).toBe(0);
  });

  it('release is a no-op when bulkhead disabled', () => {
    const service = createService({ enabled: false, maxInFlight: 5 });
    expect(() => service.release()).not.toThrow();
    expect(service.activeCount).toBe(0);
  });

  it('does not decrement active below zero on extra release', () => {
    const service = createService({ enabled: true, maxInFlight: 1 });
    service.tryAcquire();
    service.release();
    expect(service.activeCount).toBe(0);
    service.release();
    expect(service.activeCount).toBe(0);
  });
});
