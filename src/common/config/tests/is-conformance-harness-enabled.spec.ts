import { isConformanceHarnessEnabled } from '../is-conformance-harness-enabled';

describe('isConformanceHarnessEnabled', () => {
  it('returns false when CONFORMANCE_HARNESS_ENABLED is unset', () => {
    expect(isConformanceHarnessEnabled({})).toBe(false);
  });

  it('returns false when CONFORMANCE_HARNESS_ENABLED is "false"', () => {
    expect(
      isConformanceHarnessEnabled({ CONFORMANCE_HARNESS_ENABLED: 'false' }),
    ).toBe(false);
  });

  it('returns false when CONFORMANCE_HARNESS_ENABLED is "TRUE" (exact match only)', () => {
    expect(
      isConformanceHarnessEnabled({ CONFORMANCE_HARNESS_ENABLED: 'TRUE' }),
    ).toBe(false);
  });

  it('returns true when CONFORMANCE_HARNESS_ENABLED is "true"', () => {
    expect(
      isConformanceHarnessEnabled({ CONFORMANCE_HARNESS_ENABLED: 'true' }),
    ).toBe(true);
  });

  it('defaults to reading process.env when no argument is passed', () => {
    const previousValue = process.env.CONFORMANCE_HARNESS_ENABLED;
    try {
      process.env.CONFORMANCE_HARNESS_ENABLED = 'true';
      expect(isConformanceHarnessEnabled()).toBe(true);
      process.env.CONFORMANCE_HARNESS_ENABLED = 'false';
      expect(isConformanceHarnessEnabled()).toBe(false);
    } finally {
      if (previousValue === undefined) {
        delete process.env.CONFORMANCE_HARNESS_ENABLED;
      } else {
        process.env.CONFORMANCE_HARNESS_ENABLED = previousValue;
      }
    }
  });
});
