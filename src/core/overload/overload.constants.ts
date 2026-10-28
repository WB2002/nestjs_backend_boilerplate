/** ALB / Terminus probe paths — must not receive synthetic 503 from under-pressure. */
export const PRESSURE_EXEMPT_PATHS = ['/health', '/health/ready'] as const;

export const DEFAULT_OVERLOAD_RETRY_AFTER_SEC = 5;
export const DEFAULT_UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS = 1_000;
