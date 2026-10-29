import type { Attributes } from '@opentelemetry/api';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { redactOtelAttributes } from '@/core/redaction/redact-otel-attributes';

type SpanExportResult = Parameters<SpanExporter['export']>[1] extends (
  result: infer R,
) => void
  ? R
  : never;

export type RedactingSpanExporterOptions = {
  enabled?: boolean;
};

function redactSpan(span: ReadableSpan): ReadableSpan {
  const attributes = redactOtelAttributes(
    span.attributes as Record<string, unknown>,
  ) as Attributes;
  const events = span.events.map((event) => {
    if (event.attributes === undefined) {
      return event;
    }
    return {
      ...event,
      attributes: redactOtelAttributes(
        event.attributes as Record<string, unknown>,
      ) as Attributes,
    };
  });
  return { ...span, attributes, events };
}

export function createRedactingSpanExporter(
  delegate: SpanExporter,
  options: RedactingSpanExporterOptions = {},
): SpanExporter {
  const enabled = options.enabled ?? true;
  return {
    export(
      spans: ReadableSpan[],
      resultCallback: (result: SpanExportResult) => void,
    ): void {
      const payload = enabled ? spans.map(redactSpan) : spans;
      delegate.export(payload, resultCallback);
    },
    shutdown(): Promise<void> {
      return delegate.shutdown();
    },
    forceFlush(): Promise<void> {
      return delegate.forceFlush?.() ?? Promise.resolve();
    },
  };
}
