import {
  DEFAULT_OVERLOAD_RETRY_AFTER_SEC,
  DEFAULT_UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS,
} from './overload.constants';
import { UnderPressureConfig } from './overload.types';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parseNonNegativeInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseUnderPressureConfig(
  env: NodeJS.ProcessEnv = process.env,
): UnderPressureConfig {
  const enabled = parseBoolean(env.UNDER_PRESSURE_ENABLED, false);
  const maxEventLoopDelayMs = parseNonNegativeInt(
    env.UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS,
    DEFAULT_UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS,
  );
  const maxHeapUsedBytes = parseNonNegativeInt(
    env.UNDER_PRESSURE_MAX_HEAP_USED_BYTES,
    0,
  );
  const maxRssBytes = parseNonNegativeInt(env.UNDER_PRESSURE_MAX_RSS_BYTES, 0);
  const retryAfterSec = Math.max(
    1,
    parseNonNegativeInt(
      env.OVERLOAD_RETRY_AFTER_SEC,
      DEFAULT_OVERLOAD_RETRY_AFTER_SEC,
    ),
  );
  const exposeStatusRoute = parseBoolean(
    env.UNDER_PRESSURE_EXPOSE_STATUS_ROUTE,
    false,
  );

  return {
    enabled,
    maxEventLoopDelayMs,
    maxHeapUsedBytes,
    maxRssBytes,
    retryAfterSec,
    exposeStatusRoute,
  };
}
