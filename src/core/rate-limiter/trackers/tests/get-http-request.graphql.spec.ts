jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { getHttpRequest } from '../../http/get-http-request';
import { resolveIpTracker } from '../ip-tracker';

describe('getHttpRequest (GraphQL)', () => {
  it('resolves Fastify request from GraphQL execution context', () => {
    const gqlReq = {
      ip: '203.0.113.9',
      headers: {},
    };
    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({ req: gqlReq }),
    });

    const context = {
      getType: () => 'graphql',
      switchToHttp: () => ({
        getRequest: () => {
          throw new Error('should not use HTTP switch for graphql');
        },
      }),
    } as unknown as ExecutionContext;

    const req = getHttpRequest(context);
    expect(resolveIpTracker(req as never)).toBe('203.0.113.9');
  });
});
