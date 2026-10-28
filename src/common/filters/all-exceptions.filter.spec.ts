import { HttpStatus } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';
import {
  HTTP_STATUS_CLIENT_CLOSED_REQUEST,
  RequestCancelledError,
  RequestDeadlineExceededError,
} from '../../core/request-deadline';
import { OverloadRejectedError } from '../../core/overload/errors/overload-rejected.error';

jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

describe('AllExceptionsFilter deadline mapping', () => {
  const reply = jest.fn();
  const httpAdapterHost = {
    httpAdapter: {
      getRequestUrl: () => '/test',
      reply,
    },
  } as unknown as HttpAdapterHost;

  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-request-id': 'req-1' } }),
      getResponse: () => ({ raw: { destroyed: false, writableEnded: false } }),
    }),
  };

  beforeEach(() => {
    reply.mockClear();
  });

  it('maps RequestDeadlineExceededError to 504', () => {
    const filter = new AllExceptionsFilter(httpAdapterHost);
    filter.catch(new RequestDeadlineExceededError(), host as never);

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statusCode: HttpStatus.GATEWAY_TIMEOUT,
        message: 'Request deadline exceeded',
      }),
      HttpStatus.GATEWAY_TIMEOUT,
    );
  });

  it('maps RequestCancelledError to 499', () => {
    const filter = new AllExceptionsFilter(httpAdapterHost);
    filter.catch(new RequestCancelledError(), host as never);

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statusCode: HTTP_STATUS_CLIENT_CLOSED_REQUEST,
        message: 'Request cancelled by client',
      }),
      HTTP_STATUS_CLIENT_CLOSED_REQUEST,
    );
  });

  it('maps OverloadRejectedError to 503 with Retry-After', () => {
    const response = {
      raw: { destroyed: false, writableEnded: false },
      header: jest.fn(),
    };
    const overloadHost = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-request-id': 'req-1' } }),
        getResponse: () => response,
      }),
    };
    const filter = new AllExceptionsFilter(httpAdapterHost);
    filter.catch(new OverloadRejectedError(), overloadHost as never);

    expect(response.header).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Service temporarily unavailable',
      }),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it('skips reply for 499 when response is already destroyed', () => {
    const closedHost = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => ({ raw: { destroyed: true, writableEnded: false } }),
      }),
    };
    const filter = new AllExceptionsFilter(httpAdapterHost);
    filter.catch(new RequestCancelledError(), closedHost as never);
    expect(reply).not.toHaveBeenCalled();
  });
});
