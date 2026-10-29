import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { createRedactingSpanExporter } from '../redacting-span-exporter';

function makeSpan(attributes: Record<string, unknown>): ReadableSpan {
  return {
    name: 'test',
    kind: 0,
    spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
    startTime: [0, 0],
    endTime: [0, 0],
    status: { code: 0 },
    attributes,
    links: [],
    events: [],
    duration: [0, 0],
    ended: true,
    resource: { attributes: {} },
    instrumentationLibrary: { name: 'test' },
  } as unknown as ReadableSpan;
}

describe('createRedactingSpanExporter', () => {
  it('redacts attributes before delegating export', () => {
    const exported: ReadableSpan[] = [];
    const delegate: SpanExporter = {
      export(spans, cb) {
        exported.push(...spans);
        cb({ code: 0 });
      },
      shutdown: async () => undefined,
    };

    const exporter = createRedactingSpanExporter(delegate, { enabled: true });
    const span = makeSpan({ password: 'sekrit', 'http.method': 'GET' });

    exporter.export([span], () => undefined);

    expect(exported[0]?.attributes?.password).toBe('[REDACTED]');
    expect(exported[0]?.attributes?.['http.method']).toBe('GET');
  });

  it('passes spans through unchanged when disabled', () => {
    const exported: ReadableSpan[] = [];
    const delegate: SpanExporter = {
      export(spans, cb) {
        exported.push(...spans);
        cb({ code: 0 });
      },
      shutdown: async () => undefined,
    };

    const exporter = createRedactingSpanExporter(delegate, { enabled: false });
    const span = makeSpan({ password: 'sekrit' });

    exporter.export([span], () => undefined);

    expect(exported[0]?.attributes?.password).toBe('sekrit');
  });
});
