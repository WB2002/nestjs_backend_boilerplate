import { FastifyAdapter } from '@nestjs/platform-fastify';
import { registerUnderPressure } from '../register-under-pressure';
import { UnderPressureConfig } from '../overload.types';

describe('registerUnderPressure', () => {
  const enabledConfig: UnderPressureConfig = {
    enabled: true,
    maxEventLoopDelayMs: 1_000,
    maxHeapUsedBytes: 0,
    maxRssBytes: 0,
    retryAfterSec: 5,
    exposeStatusRoute: false,
  };

  it('is a no-op when disabled', async () => {
    const adapter = new FastifyAdapter();
    await registerUnderPressure(adapter, {
      ...enabledConfig,
      enabled: false,
    });
    const instance = adapter.getInstance();
    expect(typeof instance.isUnderPressure).toBe('undefined');
  });

  it('registers under-pressure on the Fastify instance', async () => {
    const adapter = new FastifyAdapter();
    await registerUnderPressure(adapter, enabledConfig);
    const instance = adapter.getInstance();
    await instance.ready();
    expect(typeof instance.isUnderPressure).toBe('function');
    expect(typeof instance.memoryUsage).toBe('function');
  });
});
