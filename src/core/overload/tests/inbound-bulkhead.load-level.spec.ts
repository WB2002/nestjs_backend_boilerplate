import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { OverloadRejectedError } from '../errors/overload-rejected.error';
import { InboundLoadLevelConfig } from '../load-level/inbound-load-level.types';

const disabledLoadLevel: InboundLoadLevelConfig = {
  enabled: false,
  maxQueue: 100,
  maxWaitMs: 2_000,
  pollIntervalMs: 25,
};

const enabledLoadLevel: InboundLoadLevelConfig = {
  enabled: true,
  maxQueue: 10,
  maxWaitMs: 2_000,
  pollIntervalMs: 5,
};

function createService(loadLevel: InboundLoadLevelConfig) {
  return new InboundBulkheadService(
    { enabled: true, maxInFlight: 1 },
    loadLevel,
  );
}

describe('InboundBulkheadService load leveling', () => {
  it('fail-fast when load leveling disabled at cap', async () => {
    const service = createService(disabledLoadLevel);
    service.tryAcquire();
    await expect(
      service.acquire({ priority: ApiPriorityLevel.Normal }),
    ).rejects.toBeInstanceOf(OverloadRejectedError);
  });

  it('hands off slot to waiter on release', async () => {
    const service = createService(enabledLoadLevel);
    service.tryAcquire();
    const admitted = service.acquire({
      priority: ApiPriorityLevel.Critical,
      maxWaitMs: 2_000,
    });
    service.release();
    await expect(admitted).resolves.toBeUndefined();
    expect(service.activeCount).toBe(1);
  });

  it('release with load leveling off does not throw when queue is empty', () => {
    const service = createService(disabledLoadLevel);
    service.tryAcquire();
    expect(() => service.release()).not.toThrow();
    expect(service.activeCount).toBe(0);
    expect(() => service.release()).not.toThrow();
    expect(service.activeCount).toBe(0);
  });

  it('release with no waiters keeps active at zero', () => {
    const service = createService(enabledLoadLevel);
    service.tryAcquire();
    service.release();
    expect(service.activeCount).toBe(0);
  });
});
