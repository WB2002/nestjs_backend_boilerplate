import { HEALTH_PROBE_PATHS } from '@/common/http/health-probe-paths';

/** ALB / Terminus probe paths — must not receive synthetic 503 from under-pressure. */
export const PRESSURE_EXEMPT_PATHS = HEALTH_PROBE_PATHS;

export const DEFAULT_OVERLOAD_RETRY_AFTER_SEC = 5;
export const DEFAULT_UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS = 1_000;
export const DEFAULT_INBOUND_MAX_IN_FLIGHT = 100;

export const INBOUND_BULKHEAD_OPTIONS = 'INBOUND_BULKHEAD_OPTIONS';
export const INBOUND_LOAD_LEVEL_OPTIONS = 'INBOUND_LOAD_LEVEL_OPTIONS';
export const SKIP_INBOUND_BULKHEAD_KEY = 'skipInboundBulkhead';
export const API_PRIORITY_KEY = 'apiPriority';
export const PRIORITY_SHEDDING_OPTIONS = 'PRIORITY_SHEDDING_OPTIONS';
