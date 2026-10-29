import { ExecutionContext } from '@nestjs/common';
import { RateLimitIdentifier } from '../../enums/rate-limit-identifier.enum';
import { MissingFingerprintError } from '../../errors/missing-fingerprint.error';
import { MissingGuestIdError } from '../../errors/missing-guest-id.error';
import { resolveTracker } from '../tracker-resolver';

function mockContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('resolveTracker', () => {
  it('uses req.ip only and ignores X-Forwarded-For', () => {
    const ctx = mockContext({
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(resolveTracker(ctx, RateLimitIdentifier.Ip, {})).toBe('10.0.0.1');
  });

  it('falls back to unknown when ip missing (not XFF)', () => {
    const ctx = mockContext({
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });
    expect(resolveTracker(ctx, RateLimitIdentifier.Ip, {})).toBe('unknown');
  });

  it('fails closed when fingerprint header missing', () => {
    const ctx = mockContext({ headers: {} });
    expect(() =>
      resolveTracker(ctx, RateLimitIdentifier.DeviceFingerprint, {}),
    ).toThrow(MissingFingerprintError);
  });

  it('fails closed when guest cookie missing', () => {
    const ctx = mockContext({ cookies: {} });
    expect(() => resolveTracker(ctx, RateLimitIdentifier.GuestId, {})).toThrow(
      MissingGuestIdError,
    );
  });
});
