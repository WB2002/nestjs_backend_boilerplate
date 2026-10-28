import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_TRACING_KEY } from './decorators/skip-tracing.decorator';
import { isTraceExemptPath } from './is-trace-exempt-path';

export function shouldSkipTracing(
  ctx: ExecutionContext,
  reflector: Reflector,
): boolean {
  if (
    reflector.getAllAndOverride<boolean>(SKIP_TRACING_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
  ) {
    return true;
  }
  if (ctx.getType() === 'http') {
    const req = ctx.switchToHttp().getRequest<{ url?: string }>();
    const url = typeof req.url === 'string' ? req.url : '';
    if (isTraceExemptPath(url)) {
      return true;
    }
  }
  return false;
}
