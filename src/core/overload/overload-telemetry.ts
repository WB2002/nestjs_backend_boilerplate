import { emitServiceUnavailableMetric } from '@/core/telemetry/service-unavailable.metrics';
import { parseTelemetryConfig } from '@/core/telemetry/parse-telemetry-config';

const telemetryConfig = parseTelemetryConfig();

export function recordUnderPressure503(options: {
  path: string;
  pressureType: string;
}): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'under_pressure',
    path: options.path,
    pressureType: options.pressureType,
  });
}

export function recordInboundBulkhead503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'inbound_bulkhead',
    path,
  });
}

export function recordApiPriorityShed503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'api_priority_shed',
    path,
  });
}

export function recordHealthCheck503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'health_check',
    path,
  });
}

export function recordDependencyUnavailable503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'dependency_unavailable',
    path,
  });
}

export function recordInboundLoadLevelQueueFull503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'inbound_load_level_queue_full',
    path,
  });
}

export function recordInboundLoadLevelWaitTimeout503(path: string): void {
  void emitServiceUnavailableMetric({
    enabled: telemetryConfig.appMetricsEnabled,
    reason: 'inbound_load_level_wait_timeout',
    path,
  });
}
