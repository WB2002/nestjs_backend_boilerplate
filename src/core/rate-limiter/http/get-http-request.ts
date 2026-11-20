import { ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

function resolveGraphqlHttpRequest(
  context: ExecutionContext,
): FastifyRequest | undefined {
  // Lazy require: keeps Jest unit suites that import rate-limit trackers free of @nestjs/graphql ESM cycles.
  const { GqlExecutionContext } =
    require('@nestjs/graphql') as typeof import('@nestjs/graphql'); // eslint-disable-line @typescript-eslint/no-require-imports -- lazy load avoids Jest ESM cycle in tracker imports
  const gql = GqlExecutionContext.create(context);
  return gql.getContext().req as FastifyRequest | undefined;
}

export function getHttpRequest(context: ExecutionContext): FastifyRequest {
  if (context.getType<string>() === 'graphql') {
    const gqlReq = resolveGraphqlHttpRequest(context);
    if (gqlReq) {
      return gqlReq;
    }
  }
  return context.switchToHttp().getRequest<FastifyRequest>();
}
