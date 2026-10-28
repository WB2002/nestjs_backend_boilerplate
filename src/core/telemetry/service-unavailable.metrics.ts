import { Unit } from 'aws-embedded-metrics';
import { flushEmbeddedMetrics } from './embedded-metrics';
import type { EmitServiceUnavailableOptions } from './telemetry.types';

export async function emitServiceUnavailableMetric(
  options: EmitServiceUnavailableOptions,
): Promise<void> {
  if (!options.enabled) {
    return;
  }

  try {
    await flushEmbeddedMetrics({
      namespace: 'Application',
      dimensions: { Reason: options.reason },
      metrics: [{ name: 'ServiceUnavailable', value: 1, unit: Unit.Count }],
      properties: {
        ...(options.path ? { Path: options.path } : {}),
        ...(options.pressureType ? { PressureType: options.pressureType } : {}),
      },
    });
  } catch {
    // Metrics must never break request handling.
  }
}
