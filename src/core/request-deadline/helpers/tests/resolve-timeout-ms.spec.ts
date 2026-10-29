import {
  parsePositiveTimeoutMs,
  parseTimeoutHeader,
  resolveTimeoutMs,
} from '../resolve-timeout-ms';

describe('parseTimeoutHeader', () => {
  it('parses a positive integer header', () => {
    expect(parseTimeoutHeader({ 'x-request-timeout-ms': '5000' })).toBe(5000);
  });

  it('returns undefined for missing, invalid, or non-positive values', () => {
    expect(parseTimeoutHeader(undefined)).toBeUndefined();
    expect(parseTimeoutHeader({})).toBeUndefined();
    expect(
      parseTimeoutHeader({ 'x-request-timeout-ms': 'abc' }),
    ).toBeUndefined();
    expect(parseTimeoutHeader({ 'x-request-timeout-ms': '0' })).toBeUndefined();
    expect(
      parseTimeoutHeader({ 'x-request-timeout-ms': '-1' }),
    ).toBeUndefined();
  });
});

describe('parsePositiveTimeoutMs', () => {
  it('falls back for empty, NaN, and non-positive values', () => {
    expect(parsePositiveTimeoutMs('', 30_000)).toBe(30_000);
    expect(parsePositiveTimeoutMs('abc', 30_000)).toBe(30_000);
    expect(parsePositiveTimeoutMs(0, 30_000)).toBe(30_000);
    expect(parsePositiveTimeoutMs(-5, 30_000)).toBe(30_000);
  });

  it('parses valid values', () => {
    expect(parsePositiveTimeoutMs('5000', 30_000)).toBe(5000);
    expect(parsePositiveTimeoutMs(12_000, 30_000)).toBe(12_000);
  });
});

describe('resolveTimeoutMs', () => {
  const base = { defaultTimeoutMs: 30_000, maxTimeoutMs: 120_000 };

  it('uses default when header and route override are absent', () => {
    expect(resolveTimeoutMs(base)).toEqual({
      timeoutMs: 30_000,
      skipped: false,
    });
  });

  it('lets client header only shorten the server budget', () => {
    expect(
      resolveTimeoutMs({
        ...base,
        headerMs: 5_000,
        routeOverrideMs: 10_000,
      }),
    ).toEqual({ timeoutMs: 5_000, skipped: false });

    expect(
      resolveTimeoutMs({
        ...base,
        headerMs: 120_000,
        routeOverrideMs: 5_000,
      }),
    ).toEqual({ timeoutMs: 5_000, skipped: false });
  });

  it('uses route override when header is absent', () => {
    expect(
      resolveTimeoutMs({
        ...base,
        routeOverrideMs: 8_000,
      }),
    ).toEqual({ timeoutMs: 8_000, skipped: false });
  });

  it('clamps to maxTimeoutMs', () => {
    expect(
      resolveTimeoutMs({
        defaultTimeoutMs: 200_000,
        maxTimeoutMs: 120_000,
        headerMs: 999_999,
      }),
    ).toEqual({ timeoutMs: 120_000, skipped: false });
  });

  it('skips timer when skipped is true', () => {
    expect(
      resolveTimeoutMs({
        ...base,
        headerMs: 5_000,
        skipped: true,
      }),
    ).toEqual({ timeoutMs: undefined, skipped: true });
  });
});
