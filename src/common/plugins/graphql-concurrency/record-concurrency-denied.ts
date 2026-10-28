import { trace } from '@opentelemetry/api';
import { emitServiceUnavailableMetric } from '@/core/telemetry/service-unavailable.metrics';
import { parseTelemetryConfig } from '@/core/telemetry/parse-telemetry-config';

export async function recordGraphqlConcurrencyDenied(options: {
  operationName?: string;
}): Promise<void> {
  const span = trace.getActiveSpan();
  if (span && options.operationName) {
    span.setAttribute('graphql.operation.name', options.operationName);
  }
  const telemetry = parseTelemetryConfig();
  await emitServiceUnavailableMetric({
    enabled: telemetry.appMetricsEnabled,
    reason: 'graphql_concurrency',
    path: '/graphql',
  });
}
