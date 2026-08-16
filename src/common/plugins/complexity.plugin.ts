import {
  ApolloServerPlugin,
  GraphQLRequestContext,
  GraphQLRequestListener,
} from '@apollo/server';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getComplexity,
  simpleEstimator,
  fieldExtensionsEstimator,
} from 'graphql-query-complexity';
import { GraphQLError, separateOperations } from 'graphql';
import { RedisService } from '../redis/redis.service';
import { withoutUndefined } from '@/common/utils/object.utils';

@Injectable()
export class ComplexityPlugin implements ApolloServerPlugin {
  private readonly maxComplexity: number;
  private readonly userBudget: number;
  private readonly maxConcurrency: number;

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
  ) {
    this.maxComplexity = this.configService.get<number>(
      'GQL_MAX_COMPLEXITY',
      50,
    );
    this.userBudget = this.configService.get<number>('GQL_USER_BUDGET', 1000); // units per window
    this.maxConcurrency = this.configService.get<number>(
      'GQL_MAX_CONCURRENCY',
      3,
    );
  }

  private get redis() {
    return this.redisService.getClient();
  }

  async requestDidStart(
    requestContext: GraphQLRequestContext<Record<string, unknown>>,
  ): Promise<GraphQLRequestListener<Record<string, unknown>>> {
    const { schema } = requestContext;
    const contextValue = requestContext.contextValue as {
      req?: { user?: { id?: string } };
    };
    const userId = contextValue.req?.user?.id || 'anonymous';
    const concurrencyKey = `gql:concurrency:${userId}`;
    const maxComplexity = this.maxComplexity;
    const userBudget = this.userBudget;
    const redis = this.redis;

    // 1. Check Concurrency
    const currentConcurrency = await redis.incr(concurrencyKey);
    if (currentConcurrency > this.maxConcurrency) {
      await redis.decr(concurrencyKey);
      throw new GraphQLError(`Too many concurrent queries for user ${userId}`, {
        extensions: { code: 'TOO_MANY_CONCURRENT_REQUESTS' },
      });
    }

    return {
      async didResolveOperation({ request, document }) {
        const operationName = request.operationName;
        const operations = document ? separateOperations(document) : {};
        const operationDocument =
          (operationName ? operations[operationName] : document) ?? document;

        if (!operationDocument) {
          throw new GraphQLError('Missing GraphQL document', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }

        const complexity = getComplexity(
          withoutUndefined({
            schema,
            query: operationDocument,
            variables: request.variables,
            estimators: [
              fieldExtensionsEstimator(),
              simpleEstimator({ defaultComplexity: 1 }),
            ],
          }),
        );

        // 2. Check Max Query Complexity
        if (complexity > maxComplexity) {
          throw new GraphQLError(
            `Query complexity of ${complexity} exceeds the maximum allowed complexity of ${maxComplexity}`,
            { extensions: { code: 'QUERY_TOO_COMPLEX' } },
          );
        }

        // 3. Check Per-User Budget
        const budgetKey = `gql:budget:${userId}`;
        const currentUsage = await redis.get(budgetKey);
        const usageAmount = parseInt(currentUsage || '0', 10);

        if (usageAmount + complexity > userBudget) {
          throw new GraphQLError(
            `Query complexity of ${complexity} exceeds your remaining budget of ${
              userBudget - usageAmount
            }`,
            { extensions: { code: 'OUT_OF_BUDGET' } },
          );
        }

        // Record usage (with a 1-minute TTL for the window)
        await redis.incrby(budgetKey, complexity);
        if (!currentUsage) {
          await redis.expire(budgetKey, 60);
        }
      },

      async willSendResponse() {
        // Cleanup Concurrency on finish
        await redis.decr(concurrencyKey);
      },

      async didEncounterErrors() {
        // Cleanup Concurrency on error
        await redis.decr(concurrencyKey);
      },
    };
  }
}
