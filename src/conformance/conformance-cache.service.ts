import { BadGatewayException, HttpException, Injectable } from '@nestjs/common';
import { CacheGetOrSetOptions, CacheService } from '@/core/cache';
import { ConformanceCacheRequestDto } from './dto';

export interface ConformanceCacheResponse {
  cachedValue: string | null;
  loaderCallCount: number;
  isFromLoader: boolean;
}

@Injectable()
export class ConformanceCacheService {
  private readonly loaderCallCounts = new Map<string, number>();

  constructor(private readonly cacheService: CacheService) {}

  async getOrSet(
    request: ConformanceCacheRequestDto,
  ): Promise<ConformanceCacheResponse> {
    const cacheKey = `conformance:${request.key}`;
    const countBefore = this.loaderCallCounts.get(request.key) ?? 0;

    const loader = async (): Promise<string | null> => {
      const nextCount = (this.loaderCallCounts.get(request.key) ?? 0) + 1;
      this.loaderCallCounts.set(request.key, nextCount);

      if (request.loaderDelayMs && request.loaderDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, request.loaderDelayMs),
        );
      }

      if (request.shouldFailLoader) {
        throw new BadGatewayException('Conformance loader failed');
      }

      return request.value ?? null;
    };

    const cacheOptions: CacheGetOrSetOptions = {
      ttl: {
        softTtlMs: request.softTtlMs,
        hardTtlMs: request.hardTtlMs,
      },
      ...(request.shouldCacheNull !== undefined
        ? { cacheNull: request.shouldCacheNull }
        : {}),
      ...(request.negativeSoftTtlMs != null && request.negativeHardTtlMs != null
        ? {
            negativeTtl: {
              softTtlMs: request.negativeSoftTtlMs,
              hardTtlMs: request.negativeHardTtlMs,
            },
          }
        : {}),
    };

    let cachedValue: string | null;
    try {
      cachedValue = await this.cacheService.getOrSet<string | null>(
        cacheKey,
        loader,
        cacheOptions,
      );
    } catch (loaderError: unknown) {
      if (loaderError instanceof HttpException) {
        throw loaderError;
      }
      throw new BadGatewayException('Conformance loader failed');
    }

    const countAfter = this.loaderCallCounts.get(request.key) ?? 0;

    return {
      cachedValue: cachedValue ?? null,
      loaderCallCount: countAfter,
      isFromLoader: countAfter > countBefore,
    };
  }

  async reset(key: string): Promise<void> {
    const cacheKey = `conformance:${key}`;
    await this.cacheService.delete(cacheKey);
    this.loaderCallCounts.delete(key);
  }
}
