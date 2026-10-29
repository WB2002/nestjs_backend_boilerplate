import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InboundPriorityBulkheadGuard } from '../guards/inbound-priority-bulkhead.guard';
import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { PriorityShedRejectedError } from '../errors/priority-shed-rejected.error';
import { OverloadRejectedError } from '../errors/overload-rejected.error';
import {
  API_PRIORITY_KEY,
  SKIP_INBOUND_BULKHEAD_KEY,
} from '../overload.constants';
import { InboundLoadLevelConfig } from '../load-level/inbound-load-level.types';

jest.mock('@/core/request-deadline', () => ({
  ...jest.requireActual('@/core/request-deadline'),
  getRequestSignal: jest.fn(),
  remainingMs: jest.fn(),
}));

import { getRequestSignal, remainingMs } from '@/core/request-deadline';

const disabledLoadLevel: InboundLoadLevelConfig = {
  enabled: false,
  maxQueue: 100,
  maxWaitMs: 2_000,
  pollIntervalMs: 25,
};

const enabledLoadLevel: InboundLoadLevelConfig = {
  enabled: true,
  maxQueue: 10,
  maxWaitMs: 500,
  pollIntervalMs: 5,
};

function mockContext(
  url: string,
  priority?: ApiPriorityLevel,
  options?: { skipBulkhead?: boolean; type?: string },
): ExecutionContext {
  const finishHandlers: Array<() => void> = [];
  const res = {
    raw: {
      once: (event: string, cb: () => void) => {
        if (event === 'finish' || event === 'close') {
          finishHandlers.push(cb);
        }
      },
    },
    emitFinish: () => finishHandlers.forEach((cb) => cb()),
  };
  class MockController {}
  const handler = function mockHandler() {};
  if (priority !== undefined) {
    Reflect.defineMetadata(API_PRIORITY_KEY, priority, handler);
  }
  if (options?.skipBulkhead) {
    Reflect.defineMetadata(SKIP_INBOUND_BULKHEAD_KEY, true, handler);
  }
  return {
    getType: () => options?.type ?? 'http',
    getHandler: () => handler,
    getClass: () => MockController,
    switchToHttp: () => ({
      getRequest: () => ({ url }),
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('InboundPriorityBulkheadGuard', () => {
  const sheddingConfig = {
    enabled: true,
    defaultPriority: ApiPriorityLevel.Normal,
    thresholds: {
      critical: 1,
      high: 0.95,
      normal: 0.85,
      low: 0.7,
    },
  };

  function createGuard(
    bulkhead: InboundBulkheadService,
    loadLevel: InboundLoadLevelConfig = disabledLoadLevel,
    shedding = sheddingConfig,
  ) {
    return new InboundPriorityBulkheadGuard(
      bulkhead,
      new Reflector(),
      shedding,
      loadLevel,
    );
  }

  it('sheds low priority before hard cap', () => {
    const bulkhead = new InboundBulkheadService(
      { enabled: true, maxInFlight: 100 },
      disabledLoadLevel,
    );
    for (let i = 0; i < 70; i += 1) {
      bulkhead.tryAcquire();
    }
    const guard = createGuard(bulkhead);
    return expect(
      guard.canActivate(mockContext('/export', ApiPriorityLevel.Low)),
    ).rejects.toBeInstanceOf(PriorityShedRejectedError);
  });

  it('throws OverloadRejectedError at hard cap for critical when leveling off', async () => {
    const bulkhead = new InboundBulkheadService(
      { enabled: true, maxInFlight: 2 },
      disabledLoadLevel,
    );
    bulkhead.tryAcquire();
    bulkhead.tryAcquire();
    const guard = createGuard(bulkhead);
    await expect(
      guard.canActivate(
        mockContext('/auth/refresh', ApiPriorityLevel.Critical),
      ),
    ).rejects.toBeInstanceOf(OverloadRejectedError);
  });

  it('allows non-http contexts without acquiring', async () => {
    const bulkhead = new InboundBulkheadService(
      { enabled: true, maxInFlight: 1 },
      disabledLoadLevel,
    );
    bulkhead.tryAcquire();
    const guard = createGuard(bulkhead);
    await expect(
      guard.canActivate(mockContext('/api', undefined, { type: 'rpc' })),
    ).resolves.toBe(true);
    expect(bulkhead.activeCount).toBe(1);
  });

  it('allows when bulkhead disabled', async () => {
    const bulkhead = new InboundBulkheadService(
      { enabled: false, maxInFlight: 1 },
      disabledLoadLevel,
    );
    const guard = createGuard(bulkhead);
    await expect(guard.canActivate(mockContext('/api'))).resolves.toBe(true);
    expect(bulkhead.activeCount).toBe(0);
  });

  it('allows skip-inbound-bulkhead metadata', async () => {
    const bulkhead = new InboundBulkheadService(
      { enabled: true, maxInFlight: 1 },
      disabledLoadLevel,
    );
    bulkhead.tryAcquire();
    const guard = createGuard(bulkhead);
    await expect(
      guard.canActivate(mockContext('/api', undefined, { skipBulkhead: true })),
    ).resolves.toBe(true);
    expect(bulkhead.activeCount).toBe(1);
  });

  it('allows pressure-exempt paths', async () => {
    const bulkhead = new InboundBulkheadService(
      { enabled: true, maxInFlight: 1 },
      disabledLoadLevel,
    );
    bulkhead.tryAcquire();
    const guard = createGuard(bulkhead);
    await expect(guard.canActivate(mockContext('/health/ready'))).resolves.toBe(
      true,
    );
    expect(bulkhead.activeCount).toBe(1);
  });

  it('caps maxWaitMs by remaining request budget', async () => {
    jest.mocked(remainingMs).mockReturnValue(100);
    jest.mocked(getRequestSignal).mockReturnValue(undefined);
    const bulkhead = new InboundBulkheadService(
      { enabled: true, maxInFlight: 1 },
      enabledLoadLevel,
    );
    const acquireSpy = jest.spyOn(bulkhead, 'acquire');
    const guard = createGuard(bulkhead, enabledLoadLevel, {
      ...sheddingConfig,
      enabled: false,
    });
    await guard.canActivate(mockContext('/api/work'));
    expect(acquireSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxWaitMs: 100 }),
    );
  });

  it('passes abort signal to acquire when present', async () => {
    jest.mocked(remainingMs).mockReturnValue(undefined);
    const signal = new AbortController().signal;
    jest.mocked(getRequestSignal).mockReturnValue(signal);
    const bulkhead = new InboundBulkheadService(
      { enabled: true, maxInFlight: 2 },
      disabledLoadLevel,
    );
    const acquireSpy = jest.spyOn(bulkhead, 'acquire');
    const guard = createGuard(bulkhead);
    await guard.canActivate(mockContext('/api/work', ApiPriorityLevel.Normal));
    expect(acquireSpy).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
  });

  it('releases slot when response finishes', async () => {
    jest.mocked(remainingMs).mockReturnValue(undefined);
    jest.mocked(getRequestSignal).mockReturnValue(undefined);
    const bulkhead = new InboundBulkheadService(
      { enabled: true, maxInFlight: 1 },
      disabledLoadLevel,
    );
    const ctx = mockContext('/api/work');
    const guard = createGuard(bulkhead, disabledLoadLevel, {
      ...sheddingConfig,
      enabled: false,
    });
    await guard.canActivate(ctx);
    expect(bulkhead.activeCount).toBe(1);
    const res = ctx.switchToHttp().getResponse() as { emitFinish: () => void };
    res.emitFinish();
    expect(bulkhead.activeCount).toBe(0);
  });

  it('waits for slot when load leveling enabled', async () => {
    jest.mocked(remainingMs).mockReturnValue(undefined);
    jest.mocked(getRequestSignal).mockReturnValue(undefined);
    const bulkhead = new InboundBulkheadService(
      { enabled: true, maxInFlight: 1 },
      enabledLoadLevel,
    );
    bulkhead.tryAcquire();
    const ctx = mockContext('/api/work', ApiPriorityLevel.Normal);
    const guard = createGuard(bulkhead, enabledLoadLevel, {
      ...sheddingConfig,
      enabled: false,
    });
    const pending = guard.canActivate(ctx);
    bulkhead.release();
    await expect(pending).resolves.toBe(true);
  });
});
