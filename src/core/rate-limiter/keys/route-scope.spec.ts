import { ExecutionContext } from '@nestjs/common';
import { resolveRouteScope } from './route-scope';

function mockContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('resolveRouteScope', () => {
  it('returns app for global keyScope', () => {
    const ctx = mockContext({
      method: 'GET',
      url: '/whatever',
      routeOptions: { url: '/health' },
    });
    expect(resolveRouteScope(ctx, 'global')).toBe('app');
  });

  it('uses matched route and app:unmatched when no match', () => {
    const matched = mockContext({
      method: 'POST',
      routeOptions: { url: '/users/login' },
      url: '/users/login?x=1',
    });
    expect(resolveRouteScope(matched, 'route')).toBe('POST:/users/login');

    const unmatched = mockContext({
      method: 'GET',
      url: '/scan-999',
    });
    expect(resolveRouteScope(unmatched, 'route')).toBe('app:unmatched');
  });
});
