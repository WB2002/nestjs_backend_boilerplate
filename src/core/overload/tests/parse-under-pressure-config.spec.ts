import {
  DEFAULT_OVERLOAD_RETRY_AFTER_SEC,
  DEFAULT_UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS,
} from '../overload.constants';
import { parseUnderPressureConfig } from '../parse-under-pressure-config';

describe('parseUnderPressureConfig', () => {
  it('defaults to disabled with safe thresholds', () => {
    const config = parseUnderPressureConfig({});
    expect(config.enabled).toBe(false);
    expect(config.maxEventLoopDelayMs).toBe(
      DEFAULT_UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS,
    );
    expect(config.retryAfterSec).toBe(DEFAULT_OVERLOAD_RETRY_AFTER_SEC);
    expect(config.exposeStatusRoute).toBe(false);
  });

  it('parses enabled and optional byte limits', () => {
    const config = parseUnderPressureConfig({
      UNDER_PRESSURE_ENABLED: 'true',
      UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS: '250',
      UNDER_PRESSURE_MAX_HEAP_USED_BYTES: '100',
      UNDER_PRESSURE_MAX_RSS_BYTES: '200',
      OVERLOAD_RETRY_AFTER_SEC: '10',
      UNDER_PRESSURE_EXPOSE_STATUS_ROUTE: 'true',
    });
    expect(config.enabled).toBe(true);
    expect(config.maxEventLoopDelayMs).toBe(250);
    expect(config.maxHeapUsedBytes).toBe(100);
    expect(config.maxRssBytes).toBe(200);
    expect(config.retryAfterSec).toBe(10);
    expect(config.exposeStatusRoute).toBe(true);
  });
});
