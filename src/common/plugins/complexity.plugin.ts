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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RedisService } from '../redis/redis.service';
import { withoutUndefined } from '@/common/utils/object.utils';
import { GuestIdMiddleware } from '@/core/rate-limiter';
import { DEFAULT_GUEST_COOKIE_NAME } from '@/core/rate-limiter/constants/rate-limit.constants';
import { resolveOverloadRetryAfterSec } from '@/core/overload/resolve-overload-retry-after-sec';
import {
  acquireRedisConcurrency,
  applyGraphqlOverloadHttpHeaders,
  buildConcurrencyOverloadError,
  DEFAULT_GQL_CONCURRENCY_KEY_TTL_SEC,
  releaseRedisConcurrency,
  resolveGraphqlSubject,
} from './graphql-concurrency';

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class ComplexityPlugin implements ApolloServerPlugin {
  private readonly maxComplexity: number;
  private readonly userBudget: number;
  private readonly maxConcurrency: number;
  private readonly concurrencyKeyTtlSec: number;

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
    private guestIdMiddleware: GuestIdMiddleware,
  ) {
    this.maxComplexity = this.configService.get<number>(
      'GQL_MAX_COMPLEXITY',
      50,
    );
    this.userBudget = this.configService.get<number>('GQL_USER_BUDGET', 1000);
    this.maxConcurrency = this.configService.get<number>(
      'GQL_MAX_CONCURRENCY',
      3,
    );
    this.concurrencyKeyTtlSec = parsePositiveInt(
      this.configService.get('GQL_CONCURRENCY_KEY_TTL_SEC'),
      DEFAULT_GQL_CONCURRENCY_KEY_TTL_SEC,
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
      req?: FastifyRequest & { user?: { id?: string } };
      res?: FastifyReply;
    };
    const req = contextValue.req;
    const guestId = req
      ? this.guestIdMiddleware.readValidGuestId(req, DEFAULT_GUEST_COOKIE_NAME)
      : null;
    const { redisKey, budgetKey, label } = resolveGraphqlSubject({
      userId: req?.user?.id,
      guestId,
    });

    const maxComplexity = this.maxComplexity;
    const userBudget = this.userBudget;
    const redis = this.redis;
    const releaseState = { released: false };

    const acquired = await acquireRedisConcurrency(
      redis,
      redisKey,
      this.maxConcurrency,
      this.concurrencyKeyTtlSec,
    );
    if (!acquired.acquired) {
      applyGraphqlOverloadHttpHeaders(
        contextValue.res,
        resolveOverloadRetryAfterSec(),
      );
      throw buildConcurrencyOverloadError(label);
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

        if (complexity > maxComplexity) {
          throw new GraphQLError(
            `Query complexity of ${complexity} exceeds the maximum allowed complexity of ${maxComplexity}`,
            { extensions: { code: 'QUERY_TOO_COMPLEX' } },
          );
        }

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

        await redis.incrby(budgetKey, complexity);
        if (!currentUsage) {
          await redis.expire(budgetKey, 60);
        }
      },

      async willSendResponse() {
        await releaseRedisConcurrency(redis, redisKey, releaseState);
      },

      async didEncounterErrors() {
        await releaseRedisConcurrency(redis, redisKey, releaseState);
      },
    };
  }
}
