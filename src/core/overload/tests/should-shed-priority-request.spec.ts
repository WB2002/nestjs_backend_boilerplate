import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { DEFAULT_PRIORITY_SHEDDING_THRESHOLDS } from '../priority/default-priority-shedding-thresholds';
import { shouldShedPriorityRequest } from '../priority/should-shed-priority-request';

describe('shouldShedPriorityRequest', () => {
  const thresholds = DEFAULT_PRIORITY_SHEDDING_THRESHOLDS;

  it('does not shed when utilization is below low threshold', () => {
    expect(
      shouldShedPriorityRequest({
        active: 50,
        maxInFlight: 100,
        priority: ApiPriorityLevel.Low,
        thresholds,
      }),
    ).toBe(false);
  });

  it('sheds low priority at 70% utilization before hard cap', () => {
    expect(
      shouldShedPriorityRequest({
        active: 70,
        maxInFlight: 100,
        priority: ApiPriorityLevel.Low,
        thresholds,
      }),
    ).toBe(true);
  });

  it('still admits critical at 99% utilization', () => {
    expect(
      shouldShedPriorityRequest({
        active: 99,
        maxInFlight: 100,
        priority: ApiPriorityLevel.Critical,
        thresholds,
      }),
    ).toBe(false);
  });

  it('sheds high but not critical at 96% utilization', () => {
    expect(
      shouldShedPriorityRequest({
        active: 96,
        maxInFlight: 100,
        priority: ApiPriorityLevel.High,
        thresholds,
      }),
    ).toBe(true);
    expect(
      shouldShedPriorityRequest({
        active: 96,
        maxInFlight: 100,
        priority: ApiPriorityLevel.Critical,
        thresholds,
      }),
    ).toBe(false);
  });
});
