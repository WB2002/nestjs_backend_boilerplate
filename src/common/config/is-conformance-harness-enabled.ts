export function isConformanceHarnessEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CONFORMANCE_HARNESS_ENABLED === 'true';
}
