import { isPressureExemptPath, normalizeRequestPath } from './is-pressure-exempt-path';

describe('normalizeRequestPath', () => {
  it('strips query string and trailing slash', () => {
    expect(normalizeRequestPath('/health/ready?verbose=1')).toBe('/health/ready');
    expect(normalizeRequestPath('/health/')).toBe('/health');
  });
});

describe('isPressureExemptPath', () => {
  it('exempts Terminus probe paths', () => {
    expect(isPressureExemptPath('/health')).toBe(true);
    expect(isPressureExemptPath('/health/ready')).toBe(true);
    expect(isPressureExemptPath('/health/ready?x=1')).toBe(true);
  });

  it('does not exempt API routes', () => {
    expect(isPressureExemptPath('/auth/login')).toBe(false);
    expect(isPressureExemptPath('/graphql')).toBe(false);
  });
});
