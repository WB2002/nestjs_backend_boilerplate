import {
  DEFAULT_INBOUND_LOAD_LEVEL_MAX_QUEUE,
  DEFAULT_INBOUND_LOAD_LEVEL_MAX_WAIT_MS,
  DEFAULT_INBOUND_LOAD_LEVEL_POLL_MS,
  parseInboundLoadLevelConfig,
} from '../load-level/parse-inbound-load-level-config';

describe('parseInboundLoadLevelConfig', () => {
  it('defaults to disabled with preset queue and wait values', () => {
    const config = parseInboundLoadLevelConfig({});
    expect(config.enabled).toBe(false);
    expect(config.maxQueue).toBe(DEFAULT_INBOUND_LOAD_LEVEL_MAX_QUEUE);
    expect(config.maxWaitMs).toBe(DEFAULT_INBOUND_LOAD_LEVEL_MAX_WAIT_MS);
    expect(config.pollIntervalMs).toBe(DEFAULT_INBOUND_LOAD_LEVEL_POLL_MS);
  });

  it('parses enabled and custom tuning', () => {
    const config = parseInboundLoadLevelConfig({
      INBOUND_LOAD_LEVELING_ENABLED: 'true',
      INBOUND_LOAD_LEVEL_MAX_QUEUE: '50',
      INBOUND_LOAD_LEVEL_MAX_WAIT_MS: '500',
      INBOUND_LOAD_LEVEL_POLL_MS: '10',
    });
    expect(config.enabled).toBe(true);
    expect(config.maxQueue).toBe(50);
    expect(config.maxWaitMs).toBe(500);
    expect(config.pollIntervalMs).toBe(10);
  });
});
