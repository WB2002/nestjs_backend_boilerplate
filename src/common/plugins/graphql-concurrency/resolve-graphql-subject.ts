import {
  GQL_BUDGET_KEY_PREFIX,
  GQL_CONCURRENCY_KEY_PREFIX,
} from './graphql-concurrency.constants';

export function resolveGraphqlSubject(input: {
  userId?: string;
  guestId?: string | null;
}): { redisKey: string; budgetKey: string; label: string } {
  if (input.userId) {
    const segment = `user:${input.userId}`;
    return {
      redisKey: `${GQL_CONCURRENCY_KEY_PREFIX}${segment}`,
      budgetKey: `${GQL_BUDGET_KEY_PREFIX}${segment}`,
      label: input.userId,
    };
  }
  if (input.guestId) {
    const segment = `guest:${input.guestId}`;
    return {
      redisKey: `${GQL_CONCURRENCY_KEY_PREFIX}${segment}`,
      budgetKey: `${GQL_BUDGET_KEY_PREFIX}${segment}`,
      label: input.guestId,
    };
  }
  return {
    redisKey: `${GQL_CONCURRENCY_KEY_PREFIX}anon:shared`,
    budgetKey: `${GQL_BUDGET_KEY_PREFIX}anon:shared`,
    label: 'anonymous',
  };
}
