import { parseHttpServerTimeouts } from '../parse-http-server-timeouts';

describe('parseHttpServerTimeouts', () => {
  it('returns default 65000 keepAlive and 66000 headersTimeout when env is empty', () => {
    const timeouts = parseHttpServerTimeouts({});
    expect(timeouts).toEqual({
      keepAliveTimeoutMs: 65000,
      headersTimeoutMs: 66000,
    });
  });

  it('parses valid HTTP_KEEP_ALIVE_TIMEOUT_MS and adds 1000 ms for headersTimeout', () => {
    const timeouts = parseHttpServerTimeouts({
      HTTP_KEEP_ALIVE_TIMEOUT_MS: '30000',
    });
    expect(timeouts).toEqual({
      keepAliveTimeoutMs: 30000,
      headersTimeoutMs: 31000,
    });
  });

  it.each([
    ['not-a-number'],
    ['-1000'],
    ['0'],
    [''],
    ['   '],
    ['12.34'],
    ['30000abc'],
  ])('falls back to defaults for invalid input %p', (invalidTimeoutValue) => {
    const timeouts = parseHttpServerTimeouts({
      HTTP_KEEP_ALIVE_TIMEOUT_MS: invalidTimeoutValue,
    });
    expect(timeouts).toEqual({
      keepAliveTimeoutMs: 65000,
      headersTimeoutMs: 66000,
    });
  });
});
