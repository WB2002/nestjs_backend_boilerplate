import { buildOverloadErrorResponse } from '../build-overload-error-response';

describe('buildOverloadErrorResponse', () => {
  it('matches AllExceptionsFilter JSON shape', () => {
    const body = buildOverloadErrorResponse({
      url: '/api/foo',
      headers: { 'x-request-id': 'req-abc' },
    });

    expect(body.statusCode).toBe(503);
    expect(body.path).toBe('/api/foo');
    expect(body.requestId).toBe('req-abc');
    expect(body.message).toBe('Service temporarily unavailable');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('generates requestId when header missing', () => {
    const body = buildOverloadErrorResponse({
      url: '/x',
      headers: {},
    });
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
