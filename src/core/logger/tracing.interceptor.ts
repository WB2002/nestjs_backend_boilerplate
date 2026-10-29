import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { context, trace } from '@opentelemetry/api';
import { Observable } from 'rxjs';
import { shouldSkipTracing } from '@/core/telemetry/should-skip-tracing';
import { LoggerContext } from './logger.context';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const className = ctx.getClass().name;
    const methodName = ctx.getHandler().name;

    if (shouldSkipTracing(ctx, this.reflector)) {
      return new Observable((observer) => {
        LoggerContext.run(
          { ...LoggerContext.get(), context: className, method: methodName },
          () => {
            next.handle().subscribe({
              next: (streamedChunk) => observer.next(streamedChunk),
              error: (err) => observer.error(err),
              complete: () => observer.complete(),
            });
          },
        );
      });
    }

    const activeSpan = trace.getActiveSpan();

    if (activeSpan) {
      activeSpan.setAttributes({
        'code.namespace': className,
        'code.function': methodName,
      });
    }

    const spanContext = activeSpan?.spanContext();

    return new Observable((observer) => {
      LoggerContext.run(
        {
          ...LoggerContext.get(),
          context: className,
          method: methodName,
          ...(spanContext?.traceId ? { traceId: spanContext.traceId } : {}),
          ...(spanContext?.spanId ? { spanId: spanContext.spanId } : {}),
        },
        () => {
          context.with(
            activeSpan
              ? trace.setSpan(context.active(), activeSpan)
              : context.active(),
            () => {
              next.handle().subscribe({
                next: (streamedChunk) => observer.next(streamedChunk),
                error: (err) => observer.error(err),
                complete: () => observer.complete(),
              });
            },
          );
        },
      );
    });
  }
}
