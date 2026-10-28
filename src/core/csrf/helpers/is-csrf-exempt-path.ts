export function normalizeRequestPath(url: string): string {
  const raw = url.split('?')[0] ?? url;
  if (raw.length > 1 && raw.endsWith('/')) {
    return raw.slice(0, -1);
  }
  return raw;
}

export function isCsrfExemptPath(
  url: string,
  exemptPaths: readonly string[],
): boolean {
  const path = normalizeRequestPath(url);
  return exemptPaths.includes(path);
}
