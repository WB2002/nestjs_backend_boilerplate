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
