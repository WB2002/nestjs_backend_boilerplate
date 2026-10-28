import { isTraceExemptPath } from '../is-trace-exempt-path';

describe('isTraceExemptPath', () => {
  it('matches ALB Terminus probe paths (same as under-pressure exempt list)', () => {
    expect(isTraceExemptPath('/health')).toBe(true);
    expect(isTraceExemptPath('/health/ready')).toBe(true);
    expect(isTraceExemptPath('/health/ready?verbose=1')).toBe(true);
  });

  it('does not exempt API routes', () => {
    expect(isTraceExemptPath('/healthcare/plans')).toBe(false);
    expect(isTraceExemptPath('/api/v1/users')).toBe(false);
  });
});
