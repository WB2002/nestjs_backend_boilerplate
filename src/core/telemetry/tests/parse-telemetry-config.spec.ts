import { parseTelemetryConfig } from '../parse-telemetry-config';

describe('parseTelemetryConfig', () => {
  it('disables OTel by default when unset', () => {
    expect(parseTelemetryConfig({})).toEqual(
      expect.objectContaining({
        otelEnabled: false,
        serviceName: 'nestjs-boilerplate',
        appMetricsEnabled: true,
      }),
    );
  });

  it('enables OTel when OTEL_ENABLED=true', () => {
    expect(
      parseTelemetryConfig({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: 'api' }),
    ).toEqual(
      expect.objectContaining({
        otelEnabled: true,
        serviceName: 'api',
      }),
    );
  });

  it('disables app metrics when APP_METRICS_ENABLED=false', () => {
    expect(parseTelemetryConfig({ APP_METRICS_ENABLED: 'false' })).toEqual(
      expect.objectContaining({ appMetricsEnabled: false }),
    );
  });
});
