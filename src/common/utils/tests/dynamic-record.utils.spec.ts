import {
  readCookieField,
  readStringRecordField,
  buildRecordFromEntries,
} from '../dynamic-record.utils';

describe('dynamic-record.utils', () => {
  it('readStringRecordField returns string when present', () => {
    expect(
      readStringRecordField({ authorization: 'Bearer x' }, 'authorization'),
    ).toBe('Bearer x');
  });

  it('readCookieField reads session cookie by name constant', () => {
    expect(readCookieField({ session_id: 'abc' }, 'session_id')).toBe('abc');
  });

  it('buildRecordFromEntries maps without bracket assignment', () => {
    const built = buildRecordFromEntries(
      [
        ['a', 1],
        ['b', undefined],
      ],
      (key, value) => [key, value === undefined ? 'omit' : value],
    );
    expect(built).toEqual({ a: 1, b: 'omit' });
  });
});
