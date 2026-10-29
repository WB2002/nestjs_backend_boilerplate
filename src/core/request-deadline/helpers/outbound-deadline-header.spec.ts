import { REQUEST_DEADLINE_HEADER } from '../constants/request-deadline.constants';
import { resolveOutboundDeadlineHeaders } from './outbound-deadline-header';

describe('resolveOutboundDeadlineHeaders', () => {
  it('returns header when propagate is true and deadline exists', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: 1_700_000_000_000,
      }),
    ).toEqual({ [REQUEST_DEADLINE_HEADER]: '1700000000000' });
  });

  it('returns empty when propagate is true but no inbound deadline', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: undefined,
      }),
    ).toEqual({});
  });

  it('does not override caller-provided deadline header (lowercase)', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: 100,
        existingHeaders: { [REQUEST_DEADLINE_HEADER]: '200' },
      }),
    ).toEqual({});
  });

  it('does not override caller-provided deadline header (mixed case key)', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: true,
        inboundDeadlineAt: 100,
        existingHeaders: { 'X-Request-Deadline': '200' },
      }),
    ).toEqual({});
  });

  it('returns empty when propagate is false', () => {
    expect(
      resolveOutboundDeadlineHeaders({
        propagate: false,
        inboundDeadlineAt: 100,
      }),
    ).toEqual({});
  });
});
