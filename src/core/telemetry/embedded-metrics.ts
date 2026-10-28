import { createMetricsLogger, Unit } from 'aws-embedded-metrics';

export async function flushEmbeddedMetrics(options: {
  namespace: string;
  dimensions: Record<string, string>;
  metrics: Array<{ name: string; value: number; unit?: Unit }>;
  properties?: Record<string, string | number | boolean>;
}): Promise<void> {
  const logger = createMetricsLogger();
  logger.setNamespace(options.namespace);
  logger.putDimensions(options.dimensions);
  for (const metric of options.metrics) {
    logger.putMetric(metric.name, metric.value, metric.unit ?? Unit.Count);
  }
  if (options.properties) {
    for (const [key, value] of Object.entries(options.properties)) {
      logger.setProperty(key, value);
    }
  }
  await logger.flush();
}
