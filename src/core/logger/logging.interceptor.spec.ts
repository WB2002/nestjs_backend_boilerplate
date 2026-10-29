import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  it('logs redacted url when query contains secrets', (done) => {
    const interceptor = new LoggingInterceptor();
    const logSpy = jest
      .spyOn(interceptor['logger'], 'log')
      .mockImplementation((line: string) => {
        expect(line).not.toContain('sekrit');
        expect(line).toContain('/auth/callback');
        logSpy.mockRestore();
        done();
      });

    const req = {
      method: 'GET',
      url: '/auth/callback?access_token=sekrit&ok=1',
    };
    const res = { statusCode: 302 };
    const ctx = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(undefined) };

    interceptor.intercept(ctx, next).subscribe();
  });
});
