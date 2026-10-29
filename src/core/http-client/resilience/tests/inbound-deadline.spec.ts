import { mergeInboundDeadlineWithPolicy } from '../inbound-deadline';

describe('mergeInboundDeadlineWithPolicy', () => {
  it('returns policy timeouts when no inbound context', () => {
    const outcome = mergeInboundDeadlineWithPolicy({
      policyTimeoutMs: 500,
      policyTotalTimeoutMs: 5000,
    });
    expect(outcome.timeoutMs).toBe(500);
    expect(outcome.totalTimeoutMs).toBe(5000);
    expect(outcome.signal).toBeUndefined();
  });

  it('prefers explicit request signal over inbound', () => {
    const inbound = new AbortController().signal;
    const request = new AbortController().signal;
    const outcome = mergeInboundDeadlineWithPolicy({
      requestSignal: request,
      inboundSignal: inbound,
    });
    expect(outcome.signal).toBe(request);
  });

  it('attaches inbound signal when request has none', () => {
    const inbound = new AbortController().signal;
    const outcome = mergeInboundDeadlineWithPolicy({
      inboundSignal: inbound,
    });
    expect(outcome.signal).toBe(inbound);
  });

  it('caps policy timeouts by inbound remaining ms', () => {
    const outcome = mergeInboundDeadlineWithPolicy({
      requestTimeoutMs: 5000,
      policyTotalTimeoutMs: 60_000,
      inboundRemainingMs: 500,
    });
    expect(outcome.timeoutMs).toBe(500);
    expect(outcome.totalTimeoutMs).toBe(500);
  });

  it('uses inbound remaining as total when policy total is unset', () => {
    const outcome = mergeInboundDeadlineWithPolicy({
      policyTimeoutMs: 2000,
      inboundRemainingMs: 800,
    });
    expect(outcome.timeoutMs).toBe(800);
    expect(outcome.totalTimeoutMs).toBe(800);
  });
});
