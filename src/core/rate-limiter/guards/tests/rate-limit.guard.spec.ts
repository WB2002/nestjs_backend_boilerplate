import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from '../rate-limit.guard';
import { RateLimitAlgorithm } from '../../enums/rate-limit-algorithm.enum';
import { RateLimitIdentifier } from '../../enums/rate-limit-identifier.enum';
import { RateLimitStorage } from '../../enums/rate-limit-storage.enum';
import {
  RATE_LIMIT_COST_KEY,
  RATE_LIMIT_KEY,
  SKIP_RATE_LIMIT_KEY,
} from '../../constants/rate-limit.constants';
import { RateLimitBackend } from '../../types/rate-limit-backend.interface';
import { ConsumeResult } from '../../types/rate-limit.types';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let reflector: Reflector;
  let backend: jest.Mocked<RateLimitBackend>;
  let headers: Record<string, string>;

  const createContext = (
    req: Record<string, unknown> = {},
  ): ExecutionContext => {
    headers = {};
    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          ip: '127.0.0.1',
          routeOptions: { url: '/' },
          headers: {},
          cookies: { guest_id: '550e8400-e29b-41d4-a716-446655440000' },
          ...req,
        }),
        getResponse: () => ({
          header: (k: string, v: string) => {
            headers[k] = v;
          },
        }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    backend = {
      consume: jest.fn().mockResolvedValue({
        allowed: true,
        remaining: 9,
        resetMs: 30_000,
        retryAfterMs: 0,
      } satisfies ConsumeResult),
    };
    guard = new RateLimitGuard([] as never, {} as never, reflector, backend, {
      storage: RateLimitStorage.Memory,
      algorithm: RateLimitAlgorithm.FixedWindowCounter,
      methods: [
        {
          name: 'global-ip',
          identifier: RateLimitIdentifier.Ip,
          duration: 60_000,
          limit: 10,
          keyScope: 'global',
        },
      ],
    });
  });

  it('uses route metadata over global', async () => {
    jest.spyOn(reflector, 'get').mockImplementation((key, target) => {
      if (key === RATE_LIMIT_KEY && target === (guard as never)) {
        return undefined;
      }
      return undefined;
    });

    const handler = () => undefined;
    const cls = class Test {};
    const ctx = {
      ...createContext(),
      getHandler: () => handler,
      getClass: () => cls,
    } as ExecutionContext;

    jest.spyOn(reflector, 'get').mockImplementation((key, target) => {
      if (key === SKIP_RATE_LIMIT_KEY) return undefined;
      if (key === RATE_LIMIT_COST_KEY) return undefined;
      if (key === RATE_LIMIT_KEY && target === handler) {
        return {
          methods: [
            {
              name: 'route-ip',
              identifier: RateLimitIdentifier.Ip,
              duration: 60_000,
              limit: 3,
              keyScope: 'route',
            },
          ],
        };
      }
      return undefined;
    });

    await guard.canActivate(ctx);
    expect(backend.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 3,
        policy: 'route-ip',
      }),
    );
  });

  it('skips UserId when unauthenticated', async () => {
    const handler = () => undefined;
    const ctx = {
      ...createContext({ user: undefined }),
      getHandler: () => handler,
      getClass: () => class {},
    } as ExecutionContext;

    jest.spyOn(reflector, 'get').mockImplementation((key, target) => {
      if (key === RATE_LIMIT_KEY && target === handler) {
        return {
          methods: [
            {
              name: 'user',
              identifier: RateLimitIdentifier.UserId,
              duration: 60_000,
              limit: 5,
            },
          ],
        };
      }
      return undefined;
    });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(backend.consume).not.toHaveBeenCalled();
  });

  it('fails closed when GuestId cookie missing', async () => {
    const handler = () => undefined;
    const ctx = {
      ...createContext({ cookies: {} }),
      getHandler: () => handler,
      getClass: () => class {},
    } as ExecutionContext;

    jest.spyOn(reflector, 'get').mockImplementation((key, target) => {
      if (key === RATE_LIMIT_KEY && target === handler) {
        return {
          methods: [
            {
              name: 'guest',
              identifier: RateLimitIdentifier.GuestId,
              duration: 60_000,
              limit: 5,
            },
          ],
        };
      }
      return undefined;
    });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    } as Partial<HttpException>);
  });

  it('sets X-RateLimit-Reset as Unix epoch seconds', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);

    await guard.canActivate(createContext());

    expect(headers['X-RateLimit-Reset']).toBe(
      String(Math.ceil((1_700_000_000_000 + 30_000) / 1000)),
    );
    nowSpy.mockRestore();
  });
});
