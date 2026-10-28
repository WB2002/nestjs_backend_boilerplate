import * as fc from 'fast-check';
import { computeInboundUtilization } from '../../src/core/overload/priority/should-shed-priority-request';

describe('computeInboundUtilization (property)', () => {
  it('returns 1 when maxInFlight <= 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ max: 0 }),
        (active, maxInFlight) => {
          expect(computeInboundUtilization(active, maxInFlight)).toBe(1);
        },
      ),
    );
  });

  it('returns active/maxInFlight for positive maxInFlight', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (active, maxInFlight) => {
          expect(computeInboundUtilization(active, maxInFlight)).toBeCloseTo(
            active / maxInFlight,
            10,
          );
        },
      ),
    );
  });
});
