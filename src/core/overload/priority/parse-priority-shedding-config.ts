import { ApiPriorityLevel } from './api-priority-level.enum';
import { DEFAULT_PRIORITY_SHEDDING_THRESHOLDS } from './default-priority-shedding-thresholds';
import { PrioritySheddingConfig } from './priority-shedding.types';

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

function parseRatio(
  value: string | undefined,
  defaultWhenMissing: number,
): number {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return defaultWhenMissing;
  }
  return parsed;
}

function parseDefaultPriority(value: string | undefined): ApiPriorityLevel {
  const normalized = (value ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'critical':
      return ApiPriorityLevel.Critical;
    case 'high':
      return ApiPriorityLevel.High;
    case 'low':
      return ApiPriorityLevel.Low;
    case 'normal':
    case '':
      return ApiPriorityLevel.Normal;
    default:
      return ApiPriorityLevel.Normal;
  }
}

export function parsePrioritySheddingConfig(
  env: NodeJS.ProcessEnv = process.env,
): PrioritySheddingConfig {
  const isEnabled = parseBoolean(env.INBOUND_PRIORITY_SHEDDING_ENABLED, false);
  const defaultPriority = parseDefaultPriority(
    env.INBOUND_DEFAULT_API_PRIORITY,
  );
  const thresholds = {
    critical: parseRatio(
      env.INBOUND_PRIORITY_SHED_CRITICAL_AT,
      DEFAULT_PRIORITY_SHEDDING_THRESHOLDS.critical,
    ),
    high: parseRatio(
      env.INBOUND_PRIORITY_SHED_HIGH_AT,
      DEFAULT_PRIORITY_SHEDDING_THRESHOLDS.high,
    ),
    normal: parseRatio(
      env.INBOUND_PRIORITY_SHED_NORMAL_AT,
      DEFAULT_PRIORITY_SHEDDING_THRESHOLDS.normal,
    ),
    low: parseRatio(
      env.INBOUND_PRIORITY_SHED_LOW_AT,
      DEFAULT_PRIORITY_SHEDDING_THRESHOLDS.low,
    ),
  };
  return { enabled: isEnabled, defaultPriority, thresholds };
}
