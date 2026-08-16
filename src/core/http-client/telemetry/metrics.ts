import { createMetricsLogger, Unit } from 'aws-embedded-metrics';
import type { ClientIdentity } from '../types';

export async function emitHttpMetrics(options: {
  enabled: boolean;
  identity: ClientIdentity;
  method: string;
  status?: number;
  latencyMs: number;
  attempts: number;
  success: boolean;
  errorCode?: string;
}): Promise<void> {
  if (!options.enabled) {
    return;
  }

  const metrics = createMetricsLogger();
  metrics.setNamespace('HttpClient');
  metrics.putDimensions({
    Service: options.identity.serviceName,
    Kind: options.identity.kind,
    Method: options.method,
  });
  metrics.putMetric('Latency', options.latencyMs, Unit.Milliseconds);
  metrics.putMetric('Attempts', options.attempts, Unit.Count);
  metrics.putMetric(options.success ? 'Success' : 'Failure', 1, Unit.Count);
  if (options.status != null) {
    metrics.putMetric('HttpStatus', options.status, Unit.None);
  }
  if (options.errorCode) {
    metrics.setProperty('ErrorCode', options.errorCode);
  }
  await metrics.flush();
}
