import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import {
  RATE_LIMIT_BACKEND,
  RATE_LIMIT_COST_KEY,
  RATE_LIMIT_KEY,
  RATE_LIMIT_OPTIONS,
  SKIP_RATE_LIMIT_KEY,
} from '../constants/rate-limit.constants';
import { RateLimitBackend } from '../types/rate-limit-backend.interface';
import { RateLimitAlgorithm } from '../enums/rate-limit-algorithm.enum';
import { RateLimitStorage } from '../enums/rate-limit-storage.enum';
import {
  ConsumeContext,
  RateLimitDecoratorOptions,
  RateLimitMethodConfig,
  RateLimiterModuleOptions,
} from '../types/rate-limit.types';
import {
  MissingFingerprintError,
  MissingGuestIdError,
} from '../errors';
import { getHttpRequest } from '../http';
import { buildRateLimitKey, resolveRouteScope } from '../keys';
import { resolveTracker } from '../trackers';

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(RATE_LIMIT_BACKEND) private readonly backend: RateLimitBackend,
    @Inject(RATE_LIMIT_OPTIONS)
    private readonly rateLimitOptions: RateLimiterModuleOptions,
  ) {
    super(options, storageService, reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const methods = this.resolveMethods(context);
    if (!methods.length) {
      return true;
    }

    const handlerCost = this.reflector.getAllAndOverride<number | undefined>(
      RATE_LIMIT_COST_KEY,
      [context.getHandler(), context.getClass()],
    );
    const decoratorAlgorithm = this.resolveDecoratorAlgorithm(context);

    const nowMs = Date.now();
    const storage = this.rateLimitOptions.storage ?? RateLimitStorage.Memory;
    const res = context.switchToHttp().getResponse();

    for (const method of methods) {
      let tracker: string | null;
      try {
        tracker = resolveTracker(context, method.identifier, this.rateLimitOptions);
      } catch (err) {
        if (err instanceof MissingFingerprintError || err instanceof MissingGuestIdError) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: err.message,
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        throw err;
      }

      // UserId: intentional skip when unauthenticated (e.g. @Public). Pair with Ip/GuestId.
      // JwtAuthGuard must run before this guard so authenticated routes have req.user.
      if (tracker == null) {
        continue;
      }

      const policy = method.policy ?? method.name;
      const algorithm =
        method.algorithm ??
        decoratorAlgorithm ??
        this.rateLimitOptions.algorithm ??
        RateLimitAlgorithm.FixedWindowCounter;
      const cost = handlerCost ?? method.cost ?? 1;
      const keyScope = method.keyScope ?? 'route';
      const routeScope = resolveRouteScope(context, keyScope);

      const consumeContext: ConsumeContext = {
        algorithm,
        key: buildRateLimitKey({
          policy,
          identifier: method.identifier,
          tracker,
          routeScope,
          storage,
          hashRouteScope: this.rateLimitOptions.hashRouteScope,
        }),
        limit: method.limit,
        durationMs: method.duration,
        cost,
        nowMs,
        burst: method.burst,
        policy,
      };

      const result = await this.backend.consume(consumeContext);

      if (this.rateLimitOptions.onDecision) {
        await this.rateLimitOptions.onDecision(consumeContext, result);
      }

      this.setRateLimitHeaders(
        res,
        method.limit,
        result.remaining,
        nowMs,
        result.resetMs,
      );

      if (!result.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        if (typeof res.header === 'function') {
          res.header('Retry-After', String(retryAfterSec));
        } else if (typeof res.setHeader === 'function') {
          res.setHeader('Retry-After', String(retryAfterSec));
        }
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too Many Requests',
            retryAfterMs: result.retryAfterMs,
            policy,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }

  private resolveMethods(context: ExecutionContext): RateLimitMethodConfig[] {
    const handlerMeta = this.reflector.get<RateLimitDecoratorOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    const classMeta = this.reflector.get<RateLimitDecoratorOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getClass(),
    );

    if (handlerMeta?.methods?.length) {
      return handlerMeta.methods;
    }
    if (classMeta?.methods?.length) {
      return classMeta.methods;
    }
    return this.rateLimitOptions.methods ?? [];
  }

  private resolveDecoratorAlgorithm(
    context: ExecutionContext,
  ): RateLimitAlgorithm | undefined {
    const handlerMeta = this.reflector.get<RateLimitDecoratorOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    const classMeta = this.reflector.get<RateLimitDecoratorOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getClass(),
    );
    return handlerMeta?.algorithm ?? classMeta?.algorithm;
  }

  private setRateLimitHeaders(
    res: {
      header?: (k: string, v: string) => void;
      setHeader?: (k: string, v: string) => void;
    },
    limit: number,
    remaining: number,
    nowMs: number,
    resetMs: number,
  ): void {
    // X-RateLimit-Reset is Unix epoch seconds (not a relative delta).
    const resetEpochSec = Math.ceil((nowMs + resetMs) / 1000);
    const pairs: Array<[string, string]> = [
      ['X-RateLimit-Limit', String(limit)],
      ['X-RateLimit-Remaining', String(Math.max(0, remaining))],
      ['X-RateLimit-Reset', String(resetEpochSec)],
    ];
    for (const [key, value] of pairs) {
      if (typeof res.header === 'function') {
        res.header(key, value);
      } else if (typeof res.setHeader === 'function') {
        res.setHeader(key, value);
      }
    }
  }
}
