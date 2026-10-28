import { FastifyAdapter } from '@nestjs/platform-fastify';
import underPressure from '@fastify/under-pressure';
import { createPressureHandler } from './create-pressure-handler';
import { UnderPressureConfig } from './overload.types';

export async function registerUnderPressure(
  adapter: FastifyAdapter,
  config: UnderPressureConfig,
): Promise<void> {
  if (!config.enabled) {
    return;
  }

  const instance = adapter.getInstance();

  await instance.register(underPressure, {
    maxEventLoopDelay: config.maxEventLoopDelayMs,
    maxHeapUsedBytes: config.maxHeapUsedBytes,
    maxRssBytes: config.maxRssBytes,
    retryAfter: config.retryAfterSec,
    exposeStatusRoute: config.exposeStatusRoute,
    pressureHandler: createPressureHandler(config),
  });
}
