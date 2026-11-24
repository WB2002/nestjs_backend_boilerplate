import { AsyncLocalStorage } from 'async_hooks';
import {
  RequestDeadlineInternals,
  RequestDeadlineStore,
} from '../types/request-deadline.types';

/**
 * Per-request deadline ALS. Application code must use helpers that expose
 * only `signal` / `deadlineAt` — never the AbortController.
 */
export class DeadlineContext {
  private static readonly storage =
    new AsyncLocalStorage<RequestDeadlineStore>();

  private static readonly internalsBySignal = new WeakMap<
    AbortSignal,
    RequestDeadlineInternals
  >();

  static run(
    store: RequestDeadlineStore,
    internals: RequestDeadlineInternals,
    callback: () => void,
  ): void {
    this.internalsBySignal.set(store.signal, internals);
    this.storage.run(store, callback);
  }

  static get(): RequestDeadlineStore | undefined {
    return this.storage.getStore();
  }

  /** Package-internal: timer/abort control. Not re-exported from index. */
  static getInternals(
    signal?: AbortSignal,
  ): RequestDeadlineInternals | undefined {
    const key = signal ?? this.storage.getStore()?.signal;
    return key ? this.internalsBySignal.get(key) : undefined;
  }

  /**
   * Package-internal: remove WeakMap ephemeron entry immediately on request finish
   * so the value→controller→signal cycle is reclaimed in V8 New Space instead of
   * being promoted to Old Space until a Major GC.
   */
  static deleteInternals(signal: AbortSignal): void {
    this.internalsBySignal.delete(signal);
  }

  static setReason(reason: NonNullable<RequestDeadlineStore['reason']>): void {
    const store = this.storage.getStore();
    if (store) {
      store.reason = reason;
    }
  }
}
