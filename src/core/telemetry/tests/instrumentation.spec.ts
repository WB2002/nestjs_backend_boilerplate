describe('registerInstrumentation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, OTEL_ENABLED: 'false' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not start SDK when OTEL_ENABLED is false', async () => {
    const { registerInstrumentation } =
      await import('../../../instrumentation');
    await expect(registerInstrumentation()).resolves.toBeUndefined();
  });

  it('wraps OTLP trace exporter with redacting exporter when OTLP endpoint is set', async () => {
    const otlpInstances: unknown[] = [];
    const wrappedExporters: unknown[] = [];

    jest.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: jest.fn().mockImplementation((opts: unknown) => {
        otlpInstances.push(opts);
        return { kind: 'otlp-base' };
      }),
    }));

    jest.doMock('../redacting-span-exporter', () => ({
      createRedactingSpanExporter: jest.fn(
        (delegate: unknown, options: unknown) => {
          wrappedExporters.push({ delegate, options });
          return { kind: 'redacting-wrapper' };
        },
      ),
    }));

    jest.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: jest
        .fn()
        .mockImplementation((opts: { traceExporter?: unknown }) => {
          return {
            start: jest.fn().mockResolvedValue(undefined),
            _traceExporter: opts.traceExporter,
          };
        }),
    }));

    process.env = {
      ...originalEnv,
      OTEL_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      LOG_REDACTION_ENABLED: 'true',
    };

    const { registerInstrumentation } =
      await import('../../../instrumentation');
    await registerInstrumentation();

    expect(otlpInstances).toHaveLength(1);
    expect(wrappedExporters).toHaveLength(1);
    expect(wrappedExporters[0]).toEqual({
      delegate: { kind: 'otlp-base' },
      options: { enabled: true },
    });
  });
});

describe('shouldIgnoreIncomingTraceForUrl', () => {
  it('aligns with isTraceExemptPath for health probes', async () => {
    const { shouldIgnoreIncomingTraceForUrl } =
      await import('../../../instrumentation');
    expect(shouldIgnoreIncomingTraceForUrl('/health')).toBe(true);
    expect(shouldIgnoreIncomingTraceForUrl('/health/ready')).toBe(true);
    expect(shouldIgnoreIncomingTraceForUrl('/healthcare')).toBe(false);
  });
});
