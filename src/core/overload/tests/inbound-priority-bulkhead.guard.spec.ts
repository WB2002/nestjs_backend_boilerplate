import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InboundPriorityBulkheadGuard } from '../guards/inbound-priority-bulkhead.guard';
import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { PriorityShedRejectedError } from '../errors/priority-shed-rejected.error';
import { OverloadRejectedError } from '../errors/overload-rejected.error';
import { API_PRIORITY_KEY } from '../overload.constants';

function mockContext(url: string, priority?: ApiPriorityLevel): ExecutionContext {
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
  return {
    getType: () => 'http',
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

  it('sheds low priority before hard cap', () => {
    const bulkhead = new InboundBulkheadService({ enabled: true, maxInFlight: 100 });
    for (let i = 0; i < 70; i += 1) {
      bulkhead.tryAcquire();
    }
    const reflector = new Reflector();
    const guard = new InboundPriorityBulkheadGuard(
      bulkhead,
      reflector,
      sheddingConfig,
    );
    expect(() =>
      guard.canActivate(mockContext('/export', ApiPriorityLevel.Low)),
    ).toThrow(PriorityShedRejectedError);
  });

  it('throws OverloadRejectedError at hard cap for critical', () => {
    const bulkhead = new InboundBulkheadService({ enabled: true, maxInFlight: 2 });
    bulkhead.tryAcquire();
    bulkhead.tryAcquire();
    const reflector = new Reflector();
    const guard = new InboundPriorityBulkheadGuard(
      bulkhead,
      reflector,
      sheddingConfig,
    );
    expect(() =>
      guard.canActivate(
        mockContext('/auth/refresh', ApiPriorityLevel.Critical),
      ),
    ).toThrow(OverloadRejectedError);
  });
});
