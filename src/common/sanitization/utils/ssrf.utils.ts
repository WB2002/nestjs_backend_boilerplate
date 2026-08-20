import { isIP } from 'node:net';
import { promises as dns } from 'node:dns';

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/**
 * Assert a user-controlled URL is safe for outbound fetch (SSRF hardening).
 * Blocks non-http(s), credentials-in-URL, localhost (incl. trailing-dot FQDN),
 * private/link-local IPs, IPv4-mapped / IPv4-compatible IPv6, 6to4, multicast,
 * and common cloud metadata endpoints.
 *
 * Sync check only — hostname literals / IPs. For user-controlled URLs prefer
 * {@link assertPublicHttpUrlAsync} which also resolves DNS and re-checks IPs.
 */
export function assertPublicHttpUrl(raw: string): URL {
  const url = parseAndAssertShape(raw);
  assertHostnameNotPrivate(url.hostname);
  return url;
}

/**
 * Like {@link assertPublicHttpUrl}, then resolves DNS and rejects if any A/AAAA
 * record is private/reserved (mitigates basic DNS rebinding for @SafeUrl).
 */
export async function assertPublicHttpUrlAsync(raw: string): Promise<URL> {
  const url = assertPublicHttpUrl(raw);
  const hostname = stripTrailingDots(
    url.hostname.toLowerCase().replace(/^\[|\]$/g, ''),
  );
  if (isIP(hostname)) {
    return url;
  }

  let records: string[];
  try {
    const result = await dns.lookup(hostname, { all: true, verbatim: true });
    records = result.map((r) => r.address);
  } catch {
    throw new UnsafeUrlError('URL hostname could not be resolved');
  }

  if (records.length === 0) {
    throw new UnsafeUrlError('URL hostname could not be resolved');
  }

  for (const address of records) {
    if (isPrivateOrReservedAddress(address)) {
      throw new UnsafeUrlError(
        'URL resolves to a private or reserved address',
      );
    }
  }

  return url;
}

function parseAndAssertShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('URL must use http or https');
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError('URL must not contain credentials');
  }

  return url;
}

function stripTrailingDots(hostname: string): string {
  return hostname.replace(/\.+$/, '');
}

function assertHostnameNotPrivate(rawHostname: string): void {
  const hostname = stripTrailingDots(
    rawHostname.toLowerCase().replace(/^\[|\]$/g, ''),
  );

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname === '::' ||
    hostname === '::1'
  ) {
    throw new UnsafeUrlError('URL hostname is not allowed');
  }

  if (METADATA_HOSTNAMES.has(hostname) || hostname === '169.254.169.254') {
    throw new UnsafeUrlError('URL hostname is not allowed');
  }

  if (isPrivateOrReservedAddress(hostname)) {
    throw new UnsafeUrlError('URL resolves to a private or reserved address');
  }
}

export function isPrivateOrReservedAddress(hostnameOrIp: string): boolean {
  const normalized = stripTrailingDots(
    hostnameOrIp.toLowerCase().replace(/^\[|\]$/g, ''),
  );
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateOrReservedIpv4(normalized);
  }
  if (ipVersion === 6) {
    return isPrivateOrReservedIpv6(normalized);
  }
  return false;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;

  // Multicast ff00::/8
  if (/^ff[0-9a-f]{2}:/i.test(normalized) || normalized.startsWith('ff')) {
    // Only treat as multicast when the first hextet is ffxx
    const firstHextet = normalized.split(':', 1)[0] ?? '';
    if (/^ff[0-9a-f]{0,2}$/i.test(firstHextet)) {
      return true;
    }
  }

  // Unique local fc00::/7, link-local fe80::/10
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9')) return true;
  if (normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

  // IPv4-mapped: ::ffff:dotted OR ::ffff:HHHH:LLLL
  const mapped = extractIpv4Mapped(normalized);
  if (mapped) {
    return isPrivateOrReservedIpv4(mapped);
  }

  // IPv4-compatible (deprecated): ::127.0.0.1 or ::7f00:1
  const compatible = extractIpv4Compatible(normalized);
  if (compatible) {
    return isPrivateOrReservedIpv4(compatible);
  }

  // 6to4 2002:XXXX:XXXX::/48 embeds IPv4 in the next 32 bits
  const sixToFour = extractSixToFourIpv4(normalized);
  if (sixToFour) {
    return isPrivateOrReservedIpv4(sixToFour);
  }

  return false;
}

/**
 * Extract dotted-quad from IPv4-mapped IPv6 forms:
 * - ::ffff:127.0.0.1
 * - ::ffff:7f00:1
 */
function extractIpv4Mapped(ipv6: string): string | undefined {
  if (!ipv6.startsWith('::ffff:')) {
    return undefined;
  }
  const rest = ipv6.slice('::ffff:'.length);
  if (isIP(rest) === 4) {
    return rest;
  }

  // Hex form: HHHH:LLLL → a.b.c.d
  const hexParts = rest.split(':');
  if (hexParts.length !== 2) {
    // Treat unknown ::ffff:* forms as reserved/unsafe
    return '0.0.0.0';
  }
  const hi = Number.parseInt(hexParts[0] ?? '', 16);
  const lo = Number.parseInt(hexParts[1] ?? '', 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    return '0.0.0.0';
  }
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Deprecated IPv4-compatible IPv6: ::a.b.c.d or ::HHHH:LLLL (not ::ffff:).
 */
function extractIpv4Compatible(ipv6: string): string | undefined {
  if (!ipv6.startsWith('::') || ipv6.startsWith('::ffff:')) {
    return undefined;
  }
  const rest = ipv6.slice(2);
  if (!rest || rest.includes('::')) {
    return undefined;
  }
  if (isIP(rest) === 4) {
    return rest;
  }
  const hexParts = rest.split(':');
  if (hexParts.length !== 2) {
    return undefined;
  }
  const hi = Number.parseInt(hexParts[0] ?? '', 16);
  const lo = Number.parseInt(hexParts[1] ?? '', 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    return undefined;
  }
  // ::1 is loopback (already handled); ::0 is unspecified
  if (hi === 0 && lo <= 1) {
    return undefined;
  }
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * 6to4: 2002:XXXX:XXXX::/48 — XXXX:XXXX is the embedded IPv4.
 */
function extractSixToFourIpv4(ipv6: string): string | undefined {
  if (!ipv6.startsWith('2002:')) {
    return undefined;
  }
  const parts = ipv6.split(':');
  if (parts.length < 3) {
    return undefined;
  }
  const hi = Number.parseInt(parts[1] ?? '', 16);
  const lo = Number.parseInt(parts[2] ?? '', 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    return undefined;
  }
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}
