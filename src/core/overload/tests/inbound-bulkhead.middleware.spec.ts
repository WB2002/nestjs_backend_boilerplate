import { EventEmitter } from 'events';
import { InboundBulkheadMiddleware } from '../inbound-bulkhead.middleware';
import { InboundBulkheadService } from '../inbound-bulkhead.service';
import { OverloadRejectedError } from '../errors/overload-rejected.error';

describe('InboundBulkheadMiddleware', () => {
  function createMiddleware(
    maxInFlight: number,
    enabled = true,
  ): {
    middleware: InboundBulkheadMiddleware;
    service: InboundBulkheadService;
  } {
    const config = { enabled, maxInFlight };
    const service = new InboundBulkheadService(config);
    return { middleware: new InboundBulkheadMiddleware(service), service };
  }

  function mockResponse(): EventEmitter & { raw: EventEmitter } {
    const raw = new EventEmitter();
    return Object.assign(raw, { raw });
  }

  it('skips health probe paths', () => {
    const { middleware } = createMiddleware(1);
    const next = jest.fn();
    middleware.use(
      { url: '/health/ready' } as never,
      mockResponse() as never,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects with OverloadRejectedError when at capacity', () => {
    const { middleware } = createMiddleware(1);
    const next = jest.fn();
    middleware.use({ url: '/api' } as never, mockResponse() as never, next);
    expect(next).toHaveBeenCalledWith();

    const next2 = jest.fn();
    middleware.use({ url: '/api' } as never, mockResponse() as never, next2);
    expect(next2).toHaveBeenCalledWith(expect.any(OverloadRejectedError));
  });

  it('releases slot when response finishes', () => {
    const { middleware, service } = createMiddleware(1);
    const res = mockResponse();
    const next = jest.fn();
    middleware.use({ url: '/api' } as never, res as never, next);
    expect(service.activeCount).toBe(1);

    res.emit('finish');
    expect(service.activeCount).toBe(0);
  });

  it('releases slot after next() when response closes', () => {
    const { middleware, service } = createMiddleware(2);
    const res = mockResponse();
    middleware.use({ url: '/api' } as never, res as never, jest.fn());
    expect(service.activeCount).toBe(1);
    res.emit('close');
    expect(service.activeCount).toBe(0);
  });
});
