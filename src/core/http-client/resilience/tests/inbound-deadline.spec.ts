import { mergeInboundDeadlineWithPolicy } from '../inbound-deadline';

describe('mergeInboundDeadlineWithPolicy', () => {
  it('returns policy timeouts when no inbound context', () => {
    const result = mergeInboundDeadlineWithPolicy({
      policyTimeoutMs: 500,
      policyTotalTimeoutMs: 5000,
    });
    expect(result.timeoutMs).toBe(500);
    expect(result.totalTimeoutMs).toBe(5000);
    expect(result.signal).toBeUndefined();
  });

  it('prefers explicit request signal over inbound', () => {
    const inbound = new AbortController().signal;
    const request = new AbortController().signal;
    const result = mergeInboundDeadlineWithPolicy({
      requestSignal: request,
      inboundSignal: inbound,
    });
    expect(result.signal).toBe(request);
  });

  it('attaches inbound signal when request has none', () => {
    const inbound = new AbortController().signal;
    const result = mergeInboundDeadlineWithPolicy({
      inboundSignal: inbound,
    });
    expect(result.signal).toBe(inbound);
  });

  it('caps policy timeouts by inbound remaining ms', () => {
    const result = mergeInboundDeadlineWithPolicy({
      requestTimeoutMs: 5000,
      policyTotalTimeoutMs: 60_000,
      inboundRemainingMs: 500,
    });
    expect(result.timeoutMs).toBe(500);
    expect(result.totalTimeoutMs).toBe(500);
  });

  it('uses inbound remaining as total when policy total is unset', () => {
    const result = mergeInboundDeadlineWithPolicy({
      policyTimeoutMs: 2000,
      inboundRemainingMs: 800,
    });
    expect(result.timeoutMs).toBe(800);
    expect(result.totalTimeoutMs).toBe(800);
  });
});
