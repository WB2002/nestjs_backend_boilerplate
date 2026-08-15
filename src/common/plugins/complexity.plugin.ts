import {
  ApolloServerPlugin,
  GraphQLRequestContext,
  GraphQLRequestListener,
} from '@apollo/server';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getComplexity,
  simpleEstimator,
  fieldExtensionsEstimator,
} from 'graphql-query-complexity';
import { GraphQLError, separateOperations } from 'graphql';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ComplexityPlugin implements ApolloServerPlugin {
  private readonly logger = new Logger(ComplexityPlugin.name);
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
    requestContext: GraphQLRequestContext<any>,
  ): Promise<GraphQLRequestListener<any>> {
    const { schema, request, document } = requestContext;
    const userId = requestContext.contextValue.req?.user?.id || 'anonymous';
    const concurrencyKey = `gql:concurrency:${userId}`;

    // 1. Check Concurrency
    const currentConcurrency = await this.redis.incr(concurrencyKey);
    if (currentConcurrency > this.maxConcurrency) {
      await this.redis.decr(concurrencyKey);
      throw new GraphQLError(`Too many concurrent queries for user ${userId}`, {
        extensions: { code: 'TOO_MANY_CONCURRENT_REQUESTS' },
      });
    }

    return {
      async didResolveOperation({ request, document }) {
        const operationName = request.operationName;
        const operationDocument = operationName
          ? separateOperations(document)[operationName]
          : document;

        const complexity = getComplexity({
          schema,
          query: operationDocument,
          variables: request.variables,
          estimators: [
            fieldExtensionsEstimator(),
            simpleEstimator({ defaultComplexity: 1 }),
          ],
        });

        // 2. Check Max Query Complexity
        if (complexity > this.maxComplexity) {
          throw new GraphQLError(
            `Query complexity of ${complexity} exceeds the maximum allowed complexity of ${this.maxComplexity}`,
            { extensions: { code: 'QUERY_TOO_COMPLEX' } },
          );
        }

        // 3. Check Per-User Budget
        const budgetKey = `gql:budget:${userId}`;
        const currentUsage = await this.redis.get(budgetKey);
        const usageAmount = parseInt(currentUsage || '0', 10);

        if (usageAmount + complexity > this.userBudget) {
          throw new GraphQLError(
            `Query complexity of ${complexity} exceeds your remaining budget of ${
              this.userBudget - usageAmount
            }`,
            { extensions: { code: 'OUT_OF_BUDGET' } },
          );
        }

        // Record usage (with a 1-minute TTL for the window)
        await this.redis.incrby(budgetKey, complexity);
        if (!currentUsage) {
          await this.redis.expire(budgetKey, 60);
        }
      },

      async willSendResponse() {
        // Cleanup Concurrency on finish
        await this.redis.decr(concurrencyKey);
      },

      async didEncounterErrors() {
        // Cleanup Concurrency on error
        await this.redis.decr(concurrencyKey);
      },
    };
  }
}
