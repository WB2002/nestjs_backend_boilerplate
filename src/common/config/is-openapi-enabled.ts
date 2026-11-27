export function isOpenApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.ENABLE_OPENAPI === 'true') {
    return true;
  }
  if (env.ENABLE_OPENAPI === 'false') {
    return false;
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  return nodeEnv !== 'production';
}
