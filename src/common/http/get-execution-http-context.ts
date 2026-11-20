import { ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type ExecutionHttpContext = {
  req: FastifyRequest;
  res: FastifyReply;
  url: string;
};

export function resolveExecutionHttpContext(
  context: ExecutionContext,
): ExecutionHttpContext | null {
  const type = context.getType<'http' | 'graphql' | 'ws' | 'rpc'>();
  if (type === 'graphql') {
    const { GqlExecutionContext } =
      require('@nestjs/graphql') as typeof import('@nestjs/graphql'); // eslint-disable-line @typescript-eslint/no-require-imports -- lazy load avoids Jest ESM cycle in overload guard tests
    const gql = GqlExecutionContext.create(context);
    const gqlContext = gql.getContext() as {
      req?: FastifyRequest;
      res?: FastifyReply;
    };
    if (gqlContext.req && gqlContext.res) {
      const url = gqlContext.req.url ?? gqlContext.req.raw?.url ?? '/graphql';
      return { req: gqlContext.req, res: gqlContext.res, url };
    }
    return null;
  }

  if (type === 'http') {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const res = context.switchToHttp().getResponse<FastifyReply>();
    const url = typeof req.url === 'string' ? req.url : '';
    return { req, res, url };
  }

  return null;
}
