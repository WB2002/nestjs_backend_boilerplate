import { expectType } from 'tsd';
import { ApiPriorityLevel } from '../../src/core/overload/priority/api-priority-level.enum';
import {
  computeInboundUtilization,
  shouldShedPriorityRequest,
} from '../../src/core/overload/priority/should-shed-priority-request';

expectType<number>(computeInboundUtilization(1, 10));

expectType<boolean>(
  shouldShedPriorityRequest({
    active: 1,
    maxInFlight: 10,
    priority: ApiPriorityLevel.Normal,
    thresholds: { critical: 1, high: 0.9, normal: 0.8, low: 0.7 },
  }),
);
