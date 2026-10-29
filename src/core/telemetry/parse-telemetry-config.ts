import type { TelemetryConfig } from './telemetry.types';

const DEFAULT_SERVICE_NAME = 'nestjs-boilerplate';

function parseBoolean(
  value: string | undefined,
  isDefaultOn: boolean,
): boolean {
  if (value == null || value === '') {
    return isDefaultOn;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return isDefaultOn;
}

export function parseTelemetryConfig(
  env: NodeJS.ProcessEnv = process.env,
): TelemetryConfig {
  const otlpEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const isOtelEnabled = parseBoolean(env.OTEL_ENABLED, false);

  return {
    otelEnabled: isOtelEnabled,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
    appMetricsEnabled: parseBoolean(env.APP_METRICS_ENABLED, true),
    ...(otlpEndpoint ? { otlpEndpoint } : {}),
  };
}

export function isAppMetricsEnabled(config: TelemetryConfig): boolean {
  return config.appMetricsEnabled;
}
