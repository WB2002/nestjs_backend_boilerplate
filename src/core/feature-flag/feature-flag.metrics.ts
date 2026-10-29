import { createMetricsLogger, Unit } from 'aws-embedded-metrics';

export async function emitFeatureFlagMetrics(options: {
  enabled: boolean;
  name:
    | 'feature_flag_evaluation_total'
    | 'feature_flag_evaluation_errors'
    | 'feature_flag_update_total'
    | 'feature_flag_update_latency'
    | 'feature_flag_stale_age'
    | 'feature_flag_redis_errors'
    | 'feature_flag_pubsub_disconnects'
    | 'feature_flag_reconciliation_total';
  value?: number;
  unit?: Unit;
  dimensions?: Record<string, string>;
}): Promise<void> {
  if (!options.enabled) {
    return;
  }

  try {
    const metrics = createMetricsLogger();
    metrics.setNamespace('FeatureFlags');
    if (options.dimensions) {
      metrics.putDimensions(options.dimensions);
    }
    metrics.putMetric(
      options.name,
      options.value ?? 1,
      options.unit ?? Unit.Count,
    );
    await metrics.flush();
  } catch {
    // Metrics must never break flag evaluation or management.
  }
}
