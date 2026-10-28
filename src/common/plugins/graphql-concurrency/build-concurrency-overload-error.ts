import { GraphQLError } from 'graphql';
import { GRAPHQL_OVERLOAD_EXTENSION_CODE } from './graphql-concurrency.constants';

export function buildConcurrencyOverloadError(
  subjectLabel: string,
): GraphQLError {
  return new GraphQLError(
    `Too many concurrent queries for subject ${subjectLabel}`,
    {
      extensions: {
        code: GRAPHQL_OVERLOAD_EXTENSION_CODE,
        http: { status: 503 },
      },
    },
  );
}

export function applyGraphqlOverloadHttpHeaders(
  reply: { header?: (name: string, value: string) => void } | undefined,
  retryAfterSec: number,
): void {
  reply?.header?.('Retry-After', String(retryAfterSec));
  reply?.header?.('Cache-Control', 'no-store');
}
