export function parseCsvPaths(
  raw: string | undefined,
  defaults: readonly string[],
): readonly string[] {
  if (raw === undefined || raw.trim() === '') {
    return defaults;
  }
  const extra = raw
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return [...defaults, ...extra];
}
