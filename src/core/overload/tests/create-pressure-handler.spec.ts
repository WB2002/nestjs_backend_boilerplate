jest.mock('@/core/telemetry/service-unavailable.metrics', () => ({
  emitServiceUnavailableMetric: jest.fn().mockResolvedValue(undefined),
}));

import { emitServiceUnavailableMetric } from '@/core/telemetry/service-unavailable.metrics';
import { createPressureHandler } from '../create-pressure-handler';
import { UnderPressureConfig } from '../overload.types';

describe('createPressureHandler', () => {
  const config: UnderPressureConfig = {
    enabled: true,
    maxEventLoopDelayMs: 1,
    maxHeapUsedBytes: 0,
    maxRssBytes: 0,
    retryAfterSec: 7,
    exposeStatusRoute: false,
  };

  it('does not reply on health paths (request proceeds)', () => {
    const handler = createPressureHandler(config);
    const reply = {
      code: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    handler(
      { url: '/health/ready' } as never,
      reply as never,
      'eventLoopDelay',
      999,
    );
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('returns 503 JSON with Retry-After on normal routes', () => {
    const handler = createPressureHandler(config);
    const reply = {
      code: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    handler(
      { url: '/auth/login', headers: { 'x-request-id': 'rid-1' } } as never,
      reply as never,
      'eventLoopDelay',
      999,
    );
    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '7');
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        path: '/auth/login',
        requestId: 'rid-1',
      }),
    );
    expect(emitServiceUnavailableMetric).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'under_pressure' }),
    );
  });
});
