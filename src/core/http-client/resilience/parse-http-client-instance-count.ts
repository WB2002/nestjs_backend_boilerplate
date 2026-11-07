export function parseHttpClientInstanceCount(
  envOrValue: NodeJS.ProcessEnv | string | number | undefined = process.env,
): number {
  if (typeof envOrValue === 'string' || typeof envOrValue === 'number') {
    const parsedCount =
      typeof envOrValue === 'number'
        ? Math.floor(envOrValue)
        : Number.parseInt(envOrValue, 10);
    return Number.isFinite(parsedCount) && parsedCount >= 1 ? parsedCount : 1;
  }
  const rawCount = envOrValue?.HTTP_CLIENT_INSTANCE_COUNT;
  const parsedCount = Number.parseInt(rawCount ?? '1', 10);
  return Number.isFinite(parsedCount) && parsedCount >= 1 ? parsedCount : 1;
}
