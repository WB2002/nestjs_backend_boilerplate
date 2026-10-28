export function parseHttpClientInstanceCount(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(env.HTTP_CLIENT_INSTANCE_COUNT ?? '1', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}
