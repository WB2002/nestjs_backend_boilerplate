import { RequestCancelledError } from '@/core/request-deadline/errors/request-cancelled.error';
import { LoadLevelQueueFullError } from '../errors/load-level-queue-full.error';
import { LoadLevelWaitTimeoutError } from '../errors/load-level-wait-timeout.error';
import { InboundLoadLevelQueue } from '../load-level/inbound-load-level-queue';
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';

describe('InboundLoadLevelQueue', () => {
  it('dequeues higher priority before lower when slot opens', async () => {
    const queue = new InboundLoadLevelQueue(10, 5);
    const order: string[] = [];

    const low = queue.enqueue({
      priority: ApiPriorityLevel.Low,
      maxWaitMs: 5_000,
    });
    const critical = queue.enqueue({
      priority: ApiPriorityLevel.Critical,
      maxWaitMs: 5_000,
    });

    const lowDone = low.then(() => order.push('low'));
    const criticalDone = critical.then(() => order.push('critical'));

    const first = queue.dequeueNextWaiter();
    expect(first).toBeDefined();
    first!();

    await criticalDone;
    expect(order).toEqual(['critical']);

    const second = queue.dequeueNextWaiter();
    expect(second).toBeDefined();
    second!();
    await lowDone;
    expect(order).toEqual(['critical', 'low']);
  });

  it('rejects when queue is full', async () => {
    const queue = new InboundLoadLevelQueue(1, 5);
    const first = queue.enqueue({
      priority: ApiPriorityLevel.Normal,
      maxWaitMs: 5_000,
    });
    await expect(
      queue.enqueue({ priority: ApiPriorityLevel.Normal, maxWaitMs: 5_000 }),
    ).rejects.toBeInstanceOf(LoadLevelQueueFullError);
    const grant = queue.dequeueNextWaiter();
    grant?.();
    await first;
  });

  it('rejects on wait timeout', async () => {
    jest.useFakeTimers();
    const queue = new InboundLoadLevelQueue(5, 10);
    const wait = queue.enqueue({
      priority: ApiPriorityLevel.Normal,
      maxWaitMs: 50,
    });
    const assertion = expect(wait).rejects.toBeInstanceOf(
      LoadLevelWaitTimeoutError,
    );
    await jest.advanceTimersByTimeAsync(60);
    await assertion;
    jest.useRealTimers();
  });

  it('rejects with RequestCancelledError when abort signal fires', async () => {
    const controller = new AbortController();
    const queue = new InboundLoadLevelQueue(5, 5);
    const wait = queue.enqueue({
      priority: ApiPriorityLevel.Normal,
      maxWaitMs: 5_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(wait).rejects.toBeInstanceOf(RequestCancelledError);
  });
});
