import { DEFAULT_INBOUND_MAX_IN_FLIGHT } from './overload.constants';
import { InboundBulkheadConfig } from './inbound-bulkhead.types';

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

export function parseInboundBulkheadConfig(
  env: NodeJS.ProcessEnv = process.env,
): InboundBulkheadConfig {
  const enabled = parseBoolean(env.INBOUND_BULKHEAD_ENABLED, false);
  const maxInFlight = parsePositiveInt(
    env.INBOUND_MAX_IN_FLIGHT,
    DEFAULT_INBOUND_MAX_IN_FLIGHT,
  );
  return { enabled, maxInFlight };
}
