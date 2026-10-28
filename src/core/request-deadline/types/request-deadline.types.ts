export type RequestDeadlineAbortReason = 'timeout' | 'client_disconnected';

export interface RequestDeadlineStore {
  signal: AbortSignal;
  /** Epoch ms when the request entered deadline middleware. */
  startedAt: number;
  /** Absolute epoch ms deadline for this request. */
  deadlineAt: number;
  reason?: RequestDeadlineAbortReason;
}

/** Internal timer handles — never exported from the public package surface. */
export interface RequestDeadlineInternals {
  clearTimer: () => void;
  /**
   * Set absolute deadline to startedAt + timeoutMsFromStart and arm remaining timer.
   * Does not extend past the current deadlineAt (client/route can only shorten).
   */
  rescheduleFromStart: (timeoutMsFromStart: number) => void;
  setReason: (reason: RequestDeadlineAbortReason) => void;
  abort: (reason: RequestDeadlineAbortReason) => void;
}

export interface RequestDeadlineModuleOptions {
  /** Default request timeout in ms when no header/route override is set. */
  defaultTimeoutMs?: number;
  /** Hard cap applied to header, route override, and default. */
  maxTimeoutMs?: number;
}
