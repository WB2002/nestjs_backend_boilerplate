import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CACHE_BACKEND,
  CACHE_LOADER_LOCK,
  CACHE_LOADER_LOCK_PREFIX,
  CACHE_OPTIONS,
} from './constants/cache.constants';
import { CacheLoaderLock } from './lock/cache-loader-lock.interface';
import { applyTtlJitter } from './ttl/apply-ttl-jitter';
import { CacheBackend } from './types/cache-backend.interface';
import {
  CacheEntry,
  CacheGetOrSetOptions,
  CacheGetResult,
  CacheModuleOptions,
  CacheTtl,
} from './types/cache.types';

const PEER_POLL_MS = 25;

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly keyPrefix: string;

  constructor(
    @Inject(CACHE_BACKEND) private readonly backend: CacheBackend,
    @Inject(CACHE_OPTIONS) private readonly options: CacheModuleOptions,
    @Optional()
    @Inject(CACHE_LOADER_LOCK)
    private readonly loaderLock?: CacheLoaderLock,
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
    const status = now >= entry.softExpiresAt ? 'stale' : 'fresh';
    if (entry.absent === true) {
      return { absent: true, status };
    }
    return { value: entry.v, status };
  }

  async set<T>(key: string, value: T, ttl?: CacheTtl): Promise<void> {
    const resolved = this.resolveTtlForWrite(ttl);
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
    options?: CacheTtl | CacheGetOrSetOptions,
  ): Promise<T> {
    const resolvedOptions = this.normalizeGetOrSetOptions(options);
    const resolved = this.resolveTtl(resolvedOptions.ttl);
    const existing = await this.get<T>(key);
    if (existing && 'absent' in existing) {
      if (resolvedOptions.cacheNull) {
        if (existing.status === 'fresh') {
          return null as T;
        }
        this.revalidateInBackgroundNegative(
          key,
          loader,
          resolved,
          resolvedOptions,
        );
        return null as T;
      }
      return this.loadAndSet(key, loader, resolved, resolvedOptions);
    }
    if (existing?.status === 'fresh') {
      return existing.value;
    }
    if (existing?.status === 'stale') {
      this.revalidateInBackground(key, loader, resolved, resolvedOptions);
      return existing.value;
    }
    return this.loadAndSet(key, loader, resolved, resolvedOptions);
  }

  async delete(key: string): Promise<void> {
    await this.backend.delete(this.prefixed(key));
  }

  private prefixed(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private loaderLockKey(userKey: string): string {
    return `${CACHE_LOADER_LOCK_PREFIX}${userKey}`;
  }

  private normalizeGetOrSetOptions(
    options?: CacheTtl | CacheGetOrSetOptions,
  ): CacheGetOrSetOptions {
    if (options == null) {
      return {};
    }
    if ('softTtlMs' in options && 'hardTtlMs' in options) {
      return { ttl: options };
    }
    return options;
  }

  private resolveTtlForWrite(ttl?: CacheTtl): CacheTtl {
    const resolved = this.resolveTtl(ttl);
    return applyTtlJitter(resolved, this.options.ttlJitterRatio ?? 0);
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

  private resolveNegativeTtl(options: CacheGetOrSetOptions): CacheTtl {
    const ttl =
      options.negativeTtl ??
      (this.options.defaultNegativeSoftTtlMs != null &&
      this.options.defaultNegativeHardTtlMs != null
        ? {
            softTtlMs: this.options.defaultNegativeSoftTtlMs,
            hardTtlMs: this.options.defaultNegativeHardTtlMs,
          }
        : undefined);
    if (!ttl) {
      throw new Error(
        'cacheNull requires negativeTtl or module defaultNegativeSoftTtlMs/defaultNegativeHardTtlMs',
      );
    }
    return this.resolveTtl(ttl);
  }

  private revalidateInBackground<T>(
    key: string,
    loader: () => Promise<T>,
    ttl: CacheTtl,
    options: CacheGetOrSetOptions,
  ): void {
    void this.loadAndSet(key, loader, ttl, options).catch((err: unknown) => {
      this.logger.warn(
        `Background revalidate failed for ${key}: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  private revalidateInBackgroundNegative<T>(
    key: string,
    loader: () => Promise<T>,
    ttl: CacheTtl,
    options: CacheGetOrSetOptions,
  ): void {
    void this.loadAndSet(key, loader, ttl, options).catch((err: unknown) => {
      this.logger.warn(
        `Background negative revalidate failed for ${key}: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  private loadAndSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttl: CacheTtl,
    options: CacheGetOrSetOptions,
  ): Promise<T> {
    const flightKey = this.prefixed(key);
    const existing = this.inFlight.get(flightKey);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = this.runCoalescedLoad(key, loader, ttl, options);
    this.inFlight.set(flightKey, promise);
    void promise.finally(() => {
      this.inFlight.delete(flightKey);
    });
    return promise;
  }

  private async runCoalescedLoad<T>(
    key: string,
    loader: () => Promise<T>,
    ttl: CacheTtl,
    options: CacheGetOrSetOptions,
  ): Promise<T> {
    if (this.loaderLock) {
      const lockKey = this.loaderLockKey(key);
      const lockTtlMs = this.options.loaderLockTtlMs ?? 30_000;
      const token = await this.loaderLock.tryAcquire(lockKey, lockTtlMs);
      if (!token) {
        const peer = await this.waitForPeer<T>(key, options);
        if (peer.hit) {
          return peer.value as T;
        }
        return this.executeLoader(key, loader, ttl, options);
      }
      try {
        const again = await this.get<T>(key);
        if (again && 'absent' in again && options.cacheNull) {
          return null as T;
        }
        if (
          again &&
          !('absent' in again) &&
          (again.status === 'fresh' || again.status === 'stale')
        ) {
          return again.value;
        }
        return await this.executeLoader(key, loader, ttl, options);
      } finally {
        await this.loaderLock.release(lockKey, token);
      }
    }
    return this.executeLoader(key, loader, ttl, options);
  }

  private async waitForPeer<T>(
    key: string,
    options: CacheGetOrSetOptions,
  ): Promise<{ hit: true; value: T | null } | { hit: false }> {
    const deadline =
      Date.now() + (this.options.loaderWaitMs ?? 5_000);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, PEER_POLL_MS));
      const hit = await this.get<T>(key);
      if (hit && 'absent' in hit && options.cacheNull) {
        return { hit: true, value: null };
      }
      if (
        hit &&
        !('absent' in hit) &&
        (hit.status === 'fresh' || hit.status === 'stale')
      ) {
        return { hit: true, value: hit.value };
      }
    }
    this.logger.debug(`Peer wait expired for cache key ${key}; fail-open load`);
    return { hit: false };
  }

  private async executeLoader<T>(
    key: string,
    loader: () => Promise<T>,
    ttl: CacheTtl,
    options: CacheGetOrSetOptions,
  ): Promise<T> {
    const value = await loader();
    if (value === null && options.cacheNull) {
      const negativeTtl = this.resolveNegativeTtl(options);
      await this.setNegative(key, negativeTtl);
      return value;
    }
    await this.set(key, value, ttl);
    return value;
  }

  private async setNegative(key: string, ttl: CacheTtl): Promise<void> {
    const resolved = this.resolveTtlForWrite(ttl);
    const now = Date.now();
    const entry: CacheEntry<null> = {
      v: null,
      absent: true,
      softExpiresAt: now + resolved.softTtlMs,
      hardExpiresAt: now + resolved.hardTtlMs,
    };
    await this.backend.set(this.prefixed(key), entry, resolved.hardTtlMs);
  }
}
