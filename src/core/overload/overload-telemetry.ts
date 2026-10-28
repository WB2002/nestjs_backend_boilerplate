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
