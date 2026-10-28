import { ApiPriorityLevel } from './api-priority-level.enum';
import { PrioritySheddingThresholds } from './priority-shedding.types';

const THRESHOLD_BY_PRIORITY: Record<
  ApiPriorityLevel,
  keyof PrioritySheddingThresholds
> = {
  [ApiPriorityLevel.Critical]: 'critical',
  [ApiPriorityLevel.High]: 'high',
  [ApiPriorityLevel.Normal]: 'normal',
  [ApiPriorityLevel.Low]: 'low',
};

export function computeInboundUtilization(
  active: number,
  maxInFlight: number,
): number {
  if (maxInFlight <= 0) {
    return 1;
  }
  return active / maxInFlight;
}

export function shouldShedPriorityRequest(options: {
  active: number;
  maxInFlight: number;
  priority: ApiPriorityLevel;
  thresholds: PrioritySheddingThresholds;
}): boolean {
  if (options.active >= options.maxInFlight) {
    return false;
  }
  const utilization = computeInboundUtilization(
    options.active,
    options.maxInFlight,
  );
  const key = THRESHOLD_BY_PRIORITY[options.priority];
  const maxAllowed = options.thresholds[key];
  return utilization >= maxAllowed;
}
