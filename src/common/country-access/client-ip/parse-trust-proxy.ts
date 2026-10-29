/**
 * Parses TRUST_PROXY for FastifyAdapter.
 * - unset / false / 0 → false
 * - true / 1 → true
 * - comma-separated IPs/CIDRs → string[]
 */
export function parseTrustProxy(raw: string | undefined): boolean | string[] {
  let trustProxySetting: boolean | string[];

  if (raw == null || raw.trim() === '') {
    trustProxySetting = false;
  } else {
    const value = raw.trim();
    const lower = value.toLowerCase();
    if (lower === 'false' || lower === '0') {
      trustProxySetting = false;
    } else if (lower === 'true' || lower === '1') {
      trustProxySetting = true;
    } else {
      trustProxySetting = value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
  }

  return trustProxySetting;
}
