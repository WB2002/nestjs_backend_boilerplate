jest.mock('aws-embedded-metrics', () => ({
  createMetricsLogger: jest.fn(() => ({
    setNamespace: jest.fn(),
    putDimensions: jest.fn(),
    putMetric: jest.fn(),
    setProperty: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  })),
  Unit: { Count: 'Count' },
}));

import { createMetricsLogger } from 'aws-embedded-metrics';
import { emitServiceUnavailableMetric } from '../service-unavailable.metrics';

describe('emitServiceUnavailableMetric', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no-ops when disabled', async () => {
    await emitServiceUnavailableMetric({
      enabled: false,
      reason: 'inbound_bulkhead',
      path: '/api/foo',
    });
    expect(createMetricsLogger).not.toHaveBeenCalled();
  });

  it('emits Application/ServiceUnavailable with Reason dimension', async () => {
    await emitServiceUnavailableMetric({
      enabled: true,
      reason: 'under_pressure',
      path: '/auth/login',
      pressureType: 'eventLoopDelay',
    });
    const logger = (createMetricsLogger as jest.Mock).mock.results[0]?.value;
    expect(logger.setNamespace).toHaveBeenCalledWith('Application');
    expect(logger.putDimensions).toHaveBeenCalledWith({
      Reason: 'under_pressure',
    });
    expect(logger.putMetric).toHaveBeenCalledWith(
      'ServiceUnavailable',
      1,
      'Count',
    );
  });
});
