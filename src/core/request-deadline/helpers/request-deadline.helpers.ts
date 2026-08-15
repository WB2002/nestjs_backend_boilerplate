import { DeadlineContext } from '../context/deadline.context';
import { RequestCancelledError } from '../errors/request-cancelled.error';
import { RequestDeadlineExceededError } from '../errors/request-deadline-exceeded.error';
import { RequestDeadlineAbortReason } from '../types/request-deadline.types';

export function getRequestSignal(): AbortSignal | undefined {
  return DeadlineContext.get()?.signal;
}

export function getDeadlineAt(): number | undefined {
  return DeadlineContext.get()?.deadlineAt;
}

export function getDeadlineReason(): RequestDeadlineAbortReason | undefined {
  return DeadlineContext.get()?.reason;
}

export function remainingMs(now = Date.now()): number | undefined {
  const deadlineAt = getDeadlineAt();
  if (deadlineAt === undefined) {
    return undefined;
  }
  return Math.max(0, deadlineAt - now);
}

export function throwIfAborted(): void {
  const store = DeadlineContext.get();
  if (!store?.signal.aborted) {
    return;
  }

  if (store.reason === 'client_disconnected') {
    throw new RequestCancelledError();
  }
  throw new RequestDeadlineExceededError();
}
