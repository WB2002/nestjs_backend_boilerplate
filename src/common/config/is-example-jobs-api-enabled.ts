export function isExampleJobsApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.EXAMPLE_JOBS_API_ENABLED === 'true') {
    return true;
  }
  if (env.EXAMPLE_JOBS_API_ENABLED === 'false') {
    return false;
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  return nodeEnv !== 'production';
}
