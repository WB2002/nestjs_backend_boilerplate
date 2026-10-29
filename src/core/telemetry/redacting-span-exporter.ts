import type {
  ExportResult,
  ReadableSpan,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { redactOtelAttributes } from '@/core/redaction/redact-otel-attributes';

export type RedactingSpanExporterOptions = {
  enabled?: boolean;
};

function redactSpan(span: ReadableSpan): ReadableSpan {
  const attributes = redactOtelAttributes(
    span.attributes as Record<string, unknown>,
  );
  const events = span.events.map((event) => ({
    ...event,
    attributes: event.attributes
      ? redactOtelAttributes(event.attributes as Record<string, unknown>)
      : event.attributes,
  }));
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
      resultCallback: (result: ExportResult) => void,
    ): void {
      const payload = enabled ? spans.map(redactSpan) : spans;
      delegate.export(payload, resultCallback);
    },
    shutdown(): Promise<void> {
      return delegate.shutdown();
    },
    forceFlush(): Promise<void> | undefined {
      return delegate.forceFlush?.();
    },
  };
}
