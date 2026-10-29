import { ClientClosedError, RequestAbortedError } from '../errors';

export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];
  private isClosed = false;

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error('maxConcurrent must be >= 1');
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.isClosed) {
      throw new ClientClosedError('Concurrency limiter is closed');
    }
    if (signal?.aborted) {
      throw abortError(signal.reason);
    }
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: {
        resolve: () => void;
        reject: (error: Error) => void;
        signal?: AbortSignal;
        onAbort?: () => void;
      } = { resolve, reject };
      if (signal) {
        const onAbort = () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          reject(abortError(signal.reason));
        };
        waiter.signal = signal;
        waiter.onAbort = onAbort;
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
    if (this.isClosed) {
      // Permit was transferred to this waiter; return it to the pool.
      this.release();
      throw new ClientClosedError('Concurrency limiter is closed');
    }
    if (signal?.aborted) {
      this.release();
      throw abortError(signal.reason);
    }
    // Permit was transferred in release(); do not increment again.
    return () => this.release();
  }

  close(error: Error): void {
    this.isClosed = true;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next?.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      next?.reject(error);
    }
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Transfer the permit to the next waiter without opening a free slot
      // that a concurrent acquire() could claim.
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      next.resolve();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new RequestAbortedError(
    typeof reason === 'string' ? reason : 'Request aborted',
    reason !== undefined ? { cause: reason } : {},
  );
}
