import {
  DEFAULT_OVERLOAD_RETRY_AFTER_SEC,
  DEFAULT_UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS,
} from './overload.constants';
import { UnderPressureConfig } from './overload.types';

function parseBoolean(
  value: string | undefined,
  isDefaultOn: boolean,
): boolean {
  if (value === undefined || value.trim() === '') {
    return isDefaultOn;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return isDefaultOn;
}

function parseNonNegativeInt(
  value: string | undefined,
  defaultWhenMissing: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultWhenMissing;
}

export function parseUnderPressureConfig(
  env: NodeJS.ProcessEnv = process.env,
): UnderPressureConfig {
  const isEnabled = parseBoolean(env.UNDER_PRESSURE_ENABLED, false);
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
  const shouldExposeStatusRoute = parseBoolean(
    env.UNDER_PRESSURE_EXPOSE_STATUS_ROUTE,
    false,
  );

  return {
    enabled: isEnabled,
    maxEventLoopDelayMs,
    maxHeapUsedBytes,
    maxRssBytes,
    retryAfterSec,
    exposeStatusRoute: shouldExposeStatusRoute,
  };
}
