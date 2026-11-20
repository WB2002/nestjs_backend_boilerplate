import { isIP } from 'node:net';
import { promises as dns } from 'node:dns';

const DEFAULT_DNS_CACHE_TTL_MS = 60_000;
const DEFAULT_DNS_CACHE_MAX_ENTRIES = 1_000;

type DnsCacheEntry = {
  addresses: string[];
  expiresAt: number;
};

const dnsCache = new Map<string, DnsCacheEntry>();

export async function resolvePublicHostnameAddresses(
  hostname: string,
  ttlMs = DEFAULT_DNS_CACHE_TTL_MS,
): Promise<string[]> {
  const normalized = hostname.toLowerCase();
  if (isIP(normalized)) {
    return [normalized];
  }

  const now = Date.now();
  const cached = dnsCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.addresses;
  }

  const validatedUrl = await dns.lookup(normalized, {
    all: true,
    verbatim: true,
  });
  const addresses = validatedUrl.map((record) => record.address);
  enforceDnsCacheCapacity();
  dnsCache.set(normalized, { addresses, expiresAt: now + ttlMs });
  return addresses;
}

function enforceDnsCacheCapacity(
  maxEntries = DEFAULT_DNS_CACHE_MAX_ENTRIES,
): void {
  if (dnsCache.size <= maxEntries) {
    return;
  }
  const overflow = dnsCache.size - maxEntries;
  const keys = dnsCache.keys();
  for (let removed = 0; removed < overflow; removed += 1) {
    const next = keys.next();
    if (next.done) {
      break;
    }
    dnsCache.delete(next.value);
  }
}

export function resetDnsLookupCacheForTests(): void {
  dnsCache.clear();
}
