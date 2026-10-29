import { HttpStatus } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from '../all-exceptions.filter';
import {
  HTTP_STATUS_CLIENT_CLOSED_REQUEST,
  RequestCancelledError,
  RequestDeadlineExceededError,
} from '../../../core/request-deadline';
import { OverloadRejectedError } from '../../../core/overload/errors/overload-rejected.error';
import { LoadLevelQueueFullError } from '../../../core/overload/errors/load-level-queue-full.error';
import { LoadLevelWaitTimeoutError } from '../../../core/overload/errors/load-level-wait-timeout.error';
import { PriorityShedRejectedError } from '../../../core/overload/errors/priority-shed-rejected.error';

jest.mock('@/core/telemetry/service-unavailable.metrics', () => ({
  emitServiceUnavailableMetric: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

import { emitServiceUnavailableMetric } from '@/core/telemetry/service-unavailable.metrics';

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
    jest.clearAllMocks();
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

  it('maps PriorityShedRejectedError to 503 with Retry-After and api_priority_shed metric', () => {
    const response = {
      raw: { destroyed: false, writableEnded: false },
      header: jest.fn(),
    };
    const shedHost = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-request-id': 'req-1' } }),
        getResponse: () => response,
      }),
    };
    const filter = new AllExceptionsFilter(httpAdapterHost);
    filter.catch(new PriorityShedRejectedError(), shedHost as never);

    expect(response.header).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Service unavailable: request priority shed under load',
      }),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(emitServiceUnavailableMetric).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'api_priority_shed' }),
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

    expect(response.header).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Service temporarily unavailable',
      }),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(emitServiceUnavailableMetric).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'inbound_bulkhead' }),
    );
  });

  it('maps LoadLevelQueueFullError to 503 with Retry-After', () => {
    const response = {
      raw: { destroyed: false, writableEnded: false },
      header: jest.fn(),
    };
    const host503 = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => response,
      }),
    };
    const filter = new AllExceptionsFilter(httpAdapterHost);
    filter.catch(new LoadLevelQueueFullError(), host503 as never);

    expect(response.header).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    expect(emitServiceUnavailableMetric).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'inbound_load_level_queue_full' }),
    );
  });

  it('maps LoadLevelWaitTimeoutError to 503 with Retry-After', () => {
    const response = {
      raw: { destroyed: false, writableEnded: false },
      header: jest.fn(),
    };
    const host503 = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => response,
      }),
    };
    const filter = new AllExceptionsFilter(httpAdapterHost);
    filter.catch(new LoadLevelWaitTimeoutError(), host503 as never);

    expect(response.header).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    expect(emitServiceUnavailableMetric).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'inbound_load_level_wait_timeout' }),
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
