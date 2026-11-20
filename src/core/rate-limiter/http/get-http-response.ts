import { ExecutionContext } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

function resolveGraphqlHttpResponse(
  context: ExecutionContext,
): HeaderResponse | undefined {
  const { GqlExecutionContext } =
    require('@nestjs/graphql') as typeof import('@nestjs/graphql'); // eslint-disable-line @typescript-eslint/no-require-imports -- lazy load avoids Jest ESM cycle in tracker imports
  const gql = GqlExecutionContext.create(context);
  return gql.getContext().res as HeaderResponse | undefined;
}

type HeaderResponse = {
  header?: (k: string, v: string) => void;
  setHeader?: (k: string, v: string) => void;
  raw?: HeaderResponse;
};

export function getHttpResponse(context: ExecutionContext): HeaderResponse {
  if (context.getType<string>() === 'graphql') {
    const gqlRes = resolveGraphqlHttpResponse(context);
    if (gqlRes) {
      return gqlRes;
    }
  }
  return context.switchToHttp().getResponse<HeaderResponse>();
}

export function resolveReplyForHeaderAttach(
  res: HeaderResponse,
): FastifyReply | HeaderResponse {
  const raw = res.raw ?? res;
  return raw;
}
