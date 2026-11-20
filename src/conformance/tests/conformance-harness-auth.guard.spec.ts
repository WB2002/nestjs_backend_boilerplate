import { UnauthorizedException } from '@nestjs/common';
import { ConformanceHarnessAuthGuard } from '../guards/conformance-harness-auth.guard';

describe('ConformanceHarnessAuthGuard', () => {
  it('rejects missing bearer token', () => {
    const guard = new ConformanceHarnessAuthGuard({
      get: () => 'secret-token',
    } as never);
    expect(() =>
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as never),
    ).toThrow(UnauthorizedException);
  });

  it('accepts matching bearer token', () => {
    const guard = new ConformanceHarnessAuthGuard({
      get: () => 'secret-token',
    } as never);
    expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: 'Bearer secret-token' },
          }),
        }),
      } as never),
    ).toBe(true);
  });
});
