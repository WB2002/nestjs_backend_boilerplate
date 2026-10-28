import { parseUnderPressureConfig } from './parse-under-pressure-config';

export function resolveOverloadRetryAfterSec(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseUnderPressureConfig(env).retryAfterSec;
}
