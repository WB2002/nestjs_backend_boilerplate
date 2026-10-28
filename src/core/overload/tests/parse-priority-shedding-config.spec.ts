import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { parsePrioritySheddingConfig } from '../priority/parse-priority-shedding-config';

describe('parsePrioritySheddingConfig', () => {
  it('disables shedding by default', () => {
    expect(parsePrioritySheddingConfig({})).toEqual(
      expect.objectContaining({
        enabled: false,
        defaultPriority: ApiPriorityLevel.Normal,
      }),
    );
  });

  it('enables when INBOUND_PRIORITY_SHEDDING_ENABLED=true', () => {
    expect(
      parsePrioritySheddingConfig({ INBOUND_PRIORITY_SHEDDING_ENABLED: 'true' }),
    ).toEqual(expect.objectContaining({ enabled: true }));
  });

  it('parses custom low threshold', () => {
    expect(
      parsePrioritySheddingConfig({
        INBOUND_PRIORITY_SHED_LOW_AT: '0.6',
      }).thresholds.low,
    ).toBe(0.6);
  });
});
