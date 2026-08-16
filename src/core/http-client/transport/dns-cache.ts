import * as dns from 'dns';
import { promisify } from 'util';
import { LookupCallback } from '../types';
import { CacheEntry, DnsCacheOptions } from '../types/dns.types';

const lookupAsync = promisify(dns.lookup);

function noopLookup(): void {
  return;
}

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
    if (cached && cached.expiresAt > now) {
      cb(null, cached.address, cached.family);
      return;
    }

    lookupAsync(hostname, {
      family,
      hints: lookupOptions?.hints ?? this.options.hints,
      all: false,
    })
      .then((result) => {
        const address = typeof result === 'string' ? result : result.address;
        const resultFamily =
          typeof result === 'string' ? family || 4 : result.family;
        this.cache.set(key, {
          address,
          family: resultFamily,
          expiresAt: now + (this.options.ttlMs ?? 30_000),
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
}
