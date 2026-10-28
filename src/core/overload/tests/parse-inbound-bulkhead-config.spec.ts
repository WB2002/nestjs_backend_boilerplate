import { DEFAULT_INBOUND_MAX_IN_FLIGHT } from '../overload.constants';
import { parseInboundBulkheadConfig } from '../parse-inbound-bulkhead-config';

describe('parseInboundBulkheadConfig', () => {
  it('defaults to disabled with max in-flight preset', () => {
    const config = parseInboundBulkheadConfig({});
    expect(config.enabled).toBe(false);
    expect(config.maxInFlight).toBe(DEFAULT_INBOUND_MAX_IN_FLIGHT);
  });

  it('parses enabled and custom cap', () => {
    const config = parseInboundBulkheadConfig({
      INBOUND_BULKHEAD_ENABLED: 'true',
      INBOUND_MAX_IN_FLIGHT: '50',
    });
    expect(config.enabled).toBe(true);
    expect(config.maxInFlight).toBe(50);
  });
});
