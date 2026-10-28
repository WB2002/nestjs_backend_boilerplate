export type TelemetryConfig = {
  otelEnabled: boolean;
  serviceName: string;
  appMetricsEnabled: boolean;
  otlpEndpoint?: string;
};

export type ServiceUnavailableReason =
  | 'under_pressure'
  | 'inbound_bulkhead'
  | 'api_priority_shed'
  | 'graphql_concurrency'
  | 'health_check'
  | 'dependency_unavailable';

export type EmitServiceUnavailableOptions = {
  enabled: boolean;
  reason: ServiceUnavailableReason;
  path?: string;
  pressureType?: string;
};
