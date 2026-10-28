export interface UnderPressureConfig {
  enabled: boolean;
  maxEventLoopDelayMs: number;
  maxHeapUsedBytes: number;
  maxRssBytes: number;
  retryAfterSec: number;
  /** When true, exposes plugin status route (dev/diagnostics only). */
  exposeStatusRoute: boolean;
}

export interface OverloadErrorBody {
  statusCode: number;
  timestamp: string;
  path: string;
  requestId: string;
  message: string;
}
