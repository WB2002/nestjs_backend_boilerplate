import { isCsrfExemptPath } from './is-csrf-exempt-path';

describe('isCsrfExemptPath', () => {
  it('matches health paths without query string', () => {
    expect(isCsrfExemptPath('/health?x=1', ['/health'])).toBe(true);
    expect(isCsrfExemptPath('/health/ready', ['/health/ready'])).toBe(true);
    expect(isCsrfExemptPath('/api', ['/health'])).toBe(false);
  });
});
