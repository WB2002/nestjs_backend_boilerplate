import { createHash } from 'crypto';

let nextInterceptorId = 1;
const interceptorIds = new WeakMap<object, number>();

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashMaterial(value: string | Buffer | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const asString = Buffer.isBuffer(value) ? value.toString('utf8') : value;
  return sha256Hex(asString);
}

export function hashCa(
  ca: string | Buffer | Array<string | Buffer> | undefined,
): string | undefined {
  if (ca == null) {
    return undefined;
  }
  if (Array.isArray(ca)) {
    return sha256Hex(ca.map((part) => hashMaterial(part) ?? '').join('|'));
  }
  return hashMaterial(ca);
}

/** Stable identity for interceptor functions used in runtime fingerprints. */
export function interceptorId(fn: object): number {
  const existing = interceptorIds.get(fn);
  if (existing != null) {
    return existing;
  }
  const id = nextInterceptorId;
  nextInterceptorId += 1;
  interceptorIds.set(fn, id);
  return id;
}

/** Alias for policy callbacks (canRetry, coalescing key, etc.). */
export const callbackId = interceptorId;

export function sortedHeadersFingerprint(
  headers: Record<string, string>,
): string {
  const sorted = Object.fromEntries(
    Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)),
  );
  return sha256Hex(JSON.stringify(sorted));
}
