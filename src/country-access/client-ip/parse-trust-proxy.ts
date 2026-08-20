/**
 * Parses TRUST_PROXY for FastifyAdapter.
 * - unset / false / 0 → false
 * - true / 1 → true
 * - comma-separated IPs/CIDRs → string[]
 */
export function parseTrustProxy(raw: string | undefined): boolean | string[] {
  let result: boolean | string[];

  if (raw == null || raw.trim() === '') {
    result = false;
  } else {
    const value = raw.trim();
    const lower = value.toLowerCase();
    if (lower === 'false' || lower === '0') {
      result = false;
    } else if (lower === 'true' || lower === '1') {
      result = true;
    } else {
      result = value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
  }

  return result;
}
