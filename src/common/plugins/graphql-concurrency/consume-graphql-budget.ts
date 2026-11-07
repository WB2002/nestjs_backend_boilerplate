import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { GQL_CONSUME_BUDGET_LUA } from './graphql-lua.scripts';

const logger = new Logger('consume-graphql-budget');

export type GraphqlBudgetOutcome = {
  allowed: boolean;
  used: number;
  isDegraded: boolean;
};

export async function consumeGraphqlBudget(
  redis: Redis,
  key: string,
  cost: number,
  budget: number,
  windowSec: number,
): Promise<GraphqlBudgetOutcome> {
  try {
    const rawOutcome = (await redis.eval(
      GQL_CONSUME_BUDGET_LUA,
      1,
      key,
      cost,
      budget,
      windowSec,
    )) as [number, number];

    const [allowedCode, usedAmount] = rawOutcome;
    const isAllowed = allowedCode === 1;

    return {
      allowed: isAllowed,
      used: Number(usedAmount),
      isDegraded: false,
    };
  } catch (evalError) {
    logger.warn(
      `Failed to consume GraphQL budget via Lua for key "${key}", failing open: ${evalError instanceof Error ? evalError.message : String(evalError)}`,
    );
    return {
      allowed: true,
      used: 0,
      isDegraded: true,
    };
  }
}
