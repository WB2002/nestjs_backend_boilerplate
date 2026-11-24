import { RequestCancelledError } from '@/core/request-deadline/errors/request-cancelled.error';
import { LoadLevelQueueFullError } from '../errors/load-level-queue-full.error';
import { LoadLevelWaitTimeoutError } from '../errors/load-level-wait-timeout.error';
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';

type Waiter = {
  priority: ApiPriorityLevel;
  enqueuedAt: number;
  resolve: () => void;
  reject: (error: Error) => void;
};

export class InboundLoadLevelQueue {
  private readonly waiters: Waiter[] = [];

  constructor(
    readonly maxQueue: number,
    _pollIntervalMs = 0,
  ) {}

  get size(): number {
    return this.waiters.length;
  }

  enqueue(options: {
    priority: ApiPriorityLevel;
    maxWaitMs: number;
    signal?: AbortSignal;
  }): Promise<void> {
    if (this.waiters.length >= this.maxQueue) {
      return Promise.reject(new LoadLevelQueueFullError());
    }

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;

      const cleanup = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (options.signal && abortListener) {
          options.signal.removeEventListener('abort', abortListener);
          abortListener = undefined;
        }
      };

      const removeWaiter = (waiter: Waiter): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
      };

      const waiter: Waiter = {
        priority: options.priority,
        enqueuedAt: startedAt,
        resolve: () => {
          cleanup();
          removeWaiter(waiter);
          resolve();
        },
        reject: (error: Error) => {
          cleanup();
          removeWaiter(waiter);
          reject(error);
        },
      };

      this.insertSorted(waiter);

      if (options.signal?.aborted) {
        waiter.reject(new RequestCancelledError());
        return;
      }

      abortListener = (): void => {
        waiter.reject(new RequestCancelledError());
      };
      options.signal?.addEventListener('abort', abortListener, { once: true });

      timer = setTimeout(
        () => {
          waiter.reject(new LoadLevelWaitTimeoutError());
        },
        Math.max(0, options.maxWaitMs),
      );
      timer.unref?.();
    });
  }

  dequeueNextWaiter(): (() => void) | undefined {
    const next = this.waiters.shift();
    if (!next) {
      return undefined;
    }
    return () => next.resolve();
  }

  private insertSorted(waiter: Waiter): void {
    const index = this.waiters.findIndex(
      (existing) =>
        existing.priority > waiter.priority ||
        (existing.priority === waiter.priority &&
          existing.enqueuedAt > waiter.enqueuedAt),
    );
    if (index === -1) {
      this.waiters.push(waiter);
      return;
    }
    this.waiters.splice(index, 0, waiter);
  }
}
