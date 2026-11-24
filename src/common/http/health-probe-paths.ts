/** ALB / Terminus health probe paths exempt from pressure, CSRF, logging, and deadline overhead. */
export const HEALTH_PROBE_PATHS = [
  '/health',
  '/health/live',
  '/health/ready',
] as const;

export function normalizeHealthProbePath(url: string): string {
  const queryIndex = url.indexOf('?');
  const raw = queryIndex === -1 ? url : url.slice(0, queryIndex);
  if (raw.length > 1 && raw.endsWith('/')) {
    return raw.slice(0, -1);
  }
  return raw;
}

export function isHealthProbePath(url: string): boolean {
  const path = normalizeHealthProbePath(url);
  return (HEALTH_PROBE_PATHS as readonly string[]).includes(path);
}
