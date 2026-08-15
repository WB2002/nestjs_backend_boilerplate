import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_BACKEND, CACHE_OPTIONS } from './constants/cache.constants';
import { CacheBackend } from './types/cache-backend.interface';
import {
  CacheEntry,
  CacheGetResult,
  CacheModuleOptions,
  CacheTtl,
} from './types/cache.types';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly keyPrefix: string;

  constructor(
    @Inject(CACHE_BACKEND) private readonly backend: CacheBackend,
    @Inject(CACHE_OPTIONS) private readonly options: CacheModuleOptions,
  ) {
    this.keyPrefix = options.keyPrefix ?? 'cache:';
  }

  async get<T>(key: string): Promise<CacheGetResult<T> | null> {
    const entry = await this.backend.get<T>(this.prefixed(key));
    if (!entry) {
      return null;
    }
    const now = Date.now();
    if (now >= entry.hardExpiresAt) {
      await this.backend.delete(this.prefixed(key));
      return null;
    }
    if (now >= entry.softExpiresAt) {
      return { value: entry.v, status: 'stale' };
    }
    return { value: entry.v, status: 'fresh' };
  }

  async set<T>(key: string, value: T, ttl?: CacheTtl): Promise<void> {
    const resolved = this.resolveTtl(ttl);
    const now = Date.now();
    const entry: CacheEntry<T> = {
      v: value,
      softExpiresAt: now + resolved.softTtlMs,
      hardExpiresAt: now + resolved.hardTtlMs,
    };
    await this.backend.set(this.prefixed(key), entry, resolved.hardTtlMs);
  }

  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttl?: CacheTtl,
  ): Promise<T> {
    const resolved = this.resolveTtl(ttl);
    const existing = await this.get<T>(key);
    if (existing?.status === 'fresh') {
      return existing.value;
    }
    if (existing?.status === 'stale') {
      this.revalidateInBackground(key, loader, resolved);
      return existing.value;
    }
    return this.loadAndSet(key, loader, resolved);
  }

  async delete(key: string): Promise<void> {
    await this.backend.delete(this.prefixed(key));
  }

  private prefixed(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private resolveTtl(ttl?: CacheTtl): CacheTtl {
    const softTtlMs = ttl?.softTtlMs ?? this.options.defaultSoftTtlMs;
    const hardTtlMs = ttl?.hardTtlMs ?? this.options.defaultHardTtlMs;
    if (
      softTtlMs == null ||
      hardTtlMs == null ||
      !Number.isFinite(softTtlMs) ||
      !Number.isFinite(hardTtlMs)
    ) {
      throw new Error(
        'Cache TTL requires softTtlMs and hardTtlMs (pass them or set module defaults)',
      );
    }
    if (softTtlMs <= 0 || hardTtlMs <= 0) {
      throw new Error('Cache TTL values must be > 0');
    }
    if (softTtlMs > hardTtlMs) {
      throw new Error('softTtlMs must be <= hardTtlMs');
    }
    return { softTtlMs, hardTtlMs };
  }

  private revalidateInBackground<T>(
    key: string,
    loader: () => Promise<T>,
    ttl: CacheTtl,
  ): void {
    void this.loadAndSet(key, loader, ttl).catch((err: unknown) => {
      this.logger.warn(
        `Background revalidate failed for ${key}: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  private loadAndSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttl: CacheTtl,
  ): Promise<T> {
    const flightKey = this.prefixed(key);
    const existing = this.inFlight.get(flightKey);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = (async () => {
      try {
        const value = await loader();
        await this.set(key, value, ttl);
        return value;
      } finally {
        this.inFlight.delete(flightKey);
      }
    })();
    this.inFlight.set(flightKey, promise);
    return promise;
  }
}
