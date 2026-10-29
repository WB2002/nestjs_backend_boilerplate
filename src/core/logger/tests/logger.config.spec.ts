import { createRedactionFormat } from '../logger.config';

describe('createRedactionFormat', () => {
  it('redacts sensitive metadata fields on the log info object', () => {
    const format = createRedactionFormat({ enabled: true });
    const instance = format();
    const info = {
      level: 'info',
      message: 'hello',
      email: 'a@b.com',
      requestId: 'rid-1',
    };

    const transformed = instance.transform(info, instance.options) as Record<
      string,
      unknown
    >;

    expect(transformed.email).toBe('[REDACTED]');
    expect(transformed.requestId).toBe('rid-1');
    expect(transformed.message).toBe('hello');
  });

  it('passes through when disabled', () => {
    const format = createRedactionFormat({ enabled: false });
    const instance = format();
    const info = {
      level: 'info',
      message: 'hello',
      email: 'a@b.com',
    };

    const transformed = instance.transform(info, instance.options) as Record<
      string,
      unknown
    >;

    expect(transformed.email).toBe('a@b.com');
  });
});
