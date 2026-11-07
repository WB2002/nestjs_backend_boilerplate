const DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS = 65_000;
const HEADERS_TIMEOUT_OFFSET_MS = 1_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function parseHttpServerTimeouts(
  env: Record<string, string | undefined> = process.env,
): { keepAliveTimeoutMs: number; headersTimeoutMs: number } {
  const keepAliveTimeoutMs = parsePositiveInt(
    env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
    DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  );
  const headersTimeoutMs = keepAliveTimeoutMs + HEADERS_TIMEOUT_OFFSET_MS;
  return { keepAliveTimeoutMs, headersTimeoutMs };
}
