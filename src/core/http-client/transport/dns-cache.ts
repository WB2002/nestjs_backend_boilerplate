import * as dns from 'dns';
import { promisify } from 'util';
import { LookupCallback } from '../types';
import { CacheEntry, DnsCacheOptions } from '../types/dns.types';

const lookupAsync = promisify(dns.lookup);

function noopLookup(): void {
  return;
}

const DEFAULT_DNS_CACHE_MAX_ENTRIES = 1_000;

export class DnsCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly options: DnsCacheOptions = {}) {}

  lookup(
    hostname: string,
    options: dns.LookupOneOptions | LookupCallback,
    callback?: LookupCallback,
  ): void {
    const cb: LookupCallback =
      typeof options === 'function' ? options : (callback ?? noopLookup);
    const lookupOptions = typeof options === 'function' ? undefined : options;

    const family = (lookupOptions?.family ?? this.options.family ?? 0) as
      | 0
      | 4
      | 6;
    const key = `${hostname}|${family}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached) {
      if (cached.expiresAt > now) {
        cb(null, cached.address, cached.family);
        return;
      }
      this.cache.delete(key);
    }

    lookupAsync(hostname, {
      family,
      hints: lookupOptions?.hints ?? this.options.hints,
      all: false,
    })
      .then((resolvedAddresses) => {
        const address =
          typeof resolvedAddresses === 'string'
            ? resolvedAddresses
            : resolvedAddresses.address;
        const resultFamily =
          typeof resolvedAddresses === 'string'
            ? family || 4
            : resolvedAddresses.family;
        const storedAt = Date.now();
        this.evictIfNeeded(storedAt);
        this.cache.set(key, {
          address,
          family: resultFamily,
          expiresAt: storedAt + (this.options.ttlMs ?? 30_000),
        });
        cb(null, address, resultFamily);
      })
      .catch((error: NodeJS.ErrnoException) => {
        cb(error, '', 0);
      });
  }

  clear(): void {
    this.cache.clear();
  }

  private evictIfNeeded(nowMs: number): void {
    const maxEntries = this.options.maxEntries ?? DEFAULT_DNS_CACHE_MAX_ENTRIES;
    if (this.cache.size < maxEntries) {
      return;
    }
    for (const [cacheKey, cachedRecord] of this.cache) {
      if (cachedRecord.expiresAt <= nowMs) {
        this.cache.delete(cacheKey);
      }
    }
    while (this.cache.size >= maxEntries) {
      const oldestKey = this.cache.keys().next();
      if (oldestKey.done) {
        break;
      }
      this.cache.delete(oldestKey.value);
    }
  }
}
