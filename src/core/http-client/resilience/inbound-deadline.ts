import { withoutUndefined } from '../utils/without-undefined';

export interface MergeInboundDeadlineInput {
  requestSignal?: AbortSignal;
  requestTimeoutMs?: number;
  policyTimeoutMs?: number;
  policyTotalTimeoutMs?: number;
  inboundSignal?: AbortSignal;
  inboundRemainingMs?: number;
}

export interface MergeInboundDeadlineResult {
  signal?: AbortSignal;
  timeoutMs?: number;
  totalTimeoutMs?: number;
}

function minDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value != null);
  if (defined.length === 0) {
    return undefined;
  }
  return Math.min(...defined);
}

/**
 * Applies inbound ALS deadline/signal to outbound HttpClient policy.
 * Explicit request.signal is preserved; inbound signal is used only when absent.
 */
export function mergeInboundDeadlineWithPolicy(
  input: MergeInboundDeadlineInput,
): MergeInboundDeadlineResult {
  const signal = input.requestSignal ?? input.inboundSignal;

  let timeoutMs = input.requestTimeoutMs ?? input.policyTimeoutMs;
  let totalTimeoutMs = input.policyTotalTimeoutMs;

  if (input.inboundRemainingMs !== undefined) {
    const remaining = input.inboundRemainingMs;
    timeoutMs = minDefined(timeoutMs, remaining);
    totalTimeoutMs = minDefined(totalTimeoutMs, remaining);
    if (totalTimeoutMs === undefined) {
      totalTimeoutMs = remaining;
    }
  }

  return withoutUndefined({
    signal,
    timeoutMs,
    totalTimeoutMs,
  });
}
