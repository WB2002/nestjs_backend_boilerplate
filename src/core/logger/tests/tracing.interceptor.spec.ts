import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { context, trace } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { SKIP_TRACING_KEY } from '@/core/telemetry/decorators/skip-tracing.decorator';
import { TracingInterceptor } from '../tracing.interceptor';

describe('TracingInterceptor', () => {
  const reflector = new Reflector();

  it('sets code attributes on the active span', (done) => {
    const provider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(provider);
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('HTTP GET');
    const ctx = trace.setSpan(context.active(), span);

    context.with(ctx, () => {
      const interceptor = new TracingInterceptor(reflector);
      const executionContext = {
        getType: () => 'http',
        getClass: () => ({ name: 'ExampleController' }),
        getHandler: () => ({ name: 'list' }),
        switchToHttp: () => ({
          getRequest: () => ({ url: '/example' }),
        }),
      } as unknown as ExecutionContext;
      const next: CallHandler = { handle: () => of('ok') };

      interceptor.intercept(executionContext, next).subscribe({
        complete: () => {
          span.end();
          done();
        },
      });
    });
  });

  it('does not mutate spans when @SkipTracing is set', (done) => {
    const provider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(provider);
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('HTTP GET');
    const setAttributes = jest.spyOn(span, 'setAttributes');
    const ctx = trace.setSpan(context.active(), span);

    context.with(ctx, () => {
      const interceptor = new TracingInterceptor(reflector);
      const handler = function check() {};
      Reflect.defineMetadata(SKIP_TRACING_KEY, true, handler);
      const executionContext = {
        getType: () => 'http',
        getClass: () => ({ name: 'HealthController' }),
        getHandler: () => handler,
        switchToHttp: () => ({
          getRequest: () => ({ url: '/health' }),
        }),
      } as unknown as ExecutionContext;
      const next: CallHandler = { handle: () => of('ok') };

      interceptor.intercept(executionContext, next).subscribe({
        complete: () => {
          expect(setAttributes).not.toHaveBeenCalled();
          span.end();
          done();
        },
      });
    });
  });
});
