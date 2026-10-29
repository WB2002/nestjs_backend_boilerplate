import { InboundLoadLevelConfig } from './inbound-load-level.types';

export const DEFAULT_INBOUND_LOAD_LEVEL_MAX_QUEUE = 100;
export const DEFAULT_INBOUND_LOAD_LEVEL_MAX_WAIT_MS = 2_000;
export const DEFAULT_INBOUND_LOAD_LEVEL_POLL_MS = 25;

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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseInboundLoadLevelConfig(
  env: NodeJS.ProcessEnv = process.env,
): InboundLoadLevelConfig {
  return {
    enabled: parseBoolean(env.INBOUND_LOAD_LEVELING_ENABLED, false),
    maxQueue: parsePositiveInt(
      env.INBOUND_LOAD_LEVEL_MAX_QUEUE,
      DEFAULT_INBOUND_LOAD_LEVEL_MAX_QUEUE,
    ),
    maxWaitMs: parsePositiveInt(
      env.INBOUND_LOAD_LEVEL_MAX_WAIT_MS,
      DEFAULT_INBOUND_LOAD_LEVEL_MAX_WAIT_MS,
    ),
    pollIntervalMs: parsePositiveInt(
      env.INBOUND_LOAD_LEVEL_POLL_MS,
      DEFAULT_INBOUND_LOAD_LEVEL_POLL_MS,
    ),
  };
}
