import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { GqlContextType } from '@nestjs/graphql';
import { v4 as uuidv4 } from 'uuid';
import { get, has, isPlainObject, isString } from 'lodash';
import {
  HTTP_STATUS_CLIENT_CLOSED_REQUEST,
  RequestCancelledError,
  RequestDeadlineExceededError,
  getDeadlineReason,
} from '../../core/request-deadline';
import { OverloadRejectedError } from '../../core/overload/errors/overload-rejected.error';
import { LoadLevelQueueFullError } from '../../core/overload/errors/load-level-queue-full.error';
import { LoadLevelWaitTimeoutError } from '../../core/overload/errors/load-level-wait-timeout.error';
import { PriorityShedRejectedError } from '../../core/overload/errors/priority-shed-rejected.error';
import { resolveOverloadRetryAfterSec } from '../../core/overload/resolve-overload-retry-after-sec';
import {
  recordApiPriorityShed503,
  recordDependencyUnavailable503,
  recordHealthCheck503,
  recordInboundBulkhead503,
  recordInboundLoadLevelQueueFull503,
  recordInboundLoadLevelWaitTimeout503,
} from '../../core/overload/overload-telemetry';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): unknown {
    const isGql = host.getType<GqlContextType>() === 'graphql';
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    let status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const res =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    let message = isString(res)
      ? res
      : get(res, 'message', JSON.stringify(res));

    const stack = exception instanceof Error ? exception.stack : '';

    if (this.isDatabaseConnectionError(exception)) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Service temporarily unavailable';
      recordDependencyUnavailable503(httpAdapter.getRequestUrl(request));
    }

    const deadlineMapped = this.mapDeadlineException(exception);
    if (deadlineMapped) {
      status = deadlineMapped.status;
      message = deadlineMapped.message;
    }

    const overloadMapped = this.applyOverloadExceptionMappings(
      exception,
      request,
      response,
      httpAdapter,
    );
    if (overloadMapped) {
      status = overloadMapped.status;
      message = overloadMapped.message;
    }

    const isResponseDestroyed =
      get(response, 'raw.destroyed') === true ||
      get(response, 'destroyed') === true ||
      get(response, 'writableEnded') === true ||
      get(response, 'raw.writableEnded') === true;

    if (status === HTTP_STATUS_CLIENT_CLOSED_REQUEST && isResponseDestroyed) {
      this.logger.warn(
        `Exception ${status} - ${message} (response already closed)`,
      );
      return;
    }

    if (
      status === HttpStatus.GATEWAY_TIMEOUT ||
      status === HTTP_STATUS_CLIENT_CLOSED_REQUEST
    ) {
      this.logger.warn(`Exception ${status} - ${message}`);
    } else {
      this.logger.error(`Exception ${status} - ${message}`, stack);
    }

    if (isGql) {
      return exception;
    }

    // Terminus 503: response is { status, info, error, details }. Return it as proper JSON, not stringified in message.
    const isTerminusHealthResult =
      status === HttpStatus.SERVICE_UNAVAILABLE &&
      isPlainObject(res) &&
      has(res, 'details');

    if (isTerminusHealthResult) {
      recordHealthCheck503(httpAdapter.getRequestUrl(request));
    }

    const errorResponse = isTerminusHealthResult
      ? {
          statusCode: status,
          timestamp: new Date().toISOString(),
          path: httpAdapter.getRequestUrl(request),
          requestId: get(request, 'headers.x-request-id') || uuidv4(),
          ...(res as object),
        }
      : {
          statusCode: status,
          timestamp: new Date().toISOString(),
          path: httpAdapter.getRequestUrl(request),
          requestId: get(request, 'headers.x-request-id') || uuidv4(),
          message,
        };

    httpAdapter.reply(response, errorResponse, status);
    return undefined;
  }

  private isDatabaseConnectionError(exception: unknown): boolean {
    const exceptionObj = isPlainObject(exception) ? exception : {};
    const exceptionName = get(exceptionObj, 'name');
    const rawMessage = get(exceptionObj, 'message');
    const exceptionMessage = isString(rawMessage) ? rawMessage : '';
    const isNamedDbError =
      typeof exceptionName === 'string' &&
      (exceptionName === 'MongooseServerSelectionError' ||
        exceptionName === 'MongoNetworkError');
    return isNamedDbError || exceptionMessage.includes('buffering timed out');
  }

  private applyOverloadExceptionMappings(
    exception: unknown,
    request: unknown,
    response: unknown,
    httpAdapter: HttpAdapterHost['httpAdapter'],
  ): { status: number; message: string } | undefined {
    const requestUrl = httpAdapter.getRequestUrl(request);
    const priorityShedMapped = this.mapPriorityShedException(exception);
    if (priorityShedMapped) {
      this.setRetryAfterHeader(response, priorityShedMapped.retryAfterSec);
      recordApiPriorityShed503(requestUrl);
      return {
        status: priorityShedMapped.status,
        message: priorityShedMapped.message,
      };
    }

    const loadLevelQueueFullMapped =
      this.mapLoadLevelQueueFullException(exception);
    if (loadLevelQueueFullMapped) {
      this.setRetryAfterHeader(
        response,
        loadLevelQueueFullMapped.retryAfterSec,
      );
      recordInboundLoadLevelQueueFull503(requestUrl);
      return {
        status: loadLevelQueueFullMapped.status,
        message: loadLevelQueueFullMapped.message,
      };
    }

    const loadLevelTimeoutMapped =
      this.mapLoadLevelWaitTimeoutException(exception);
    if (loadLevelTimeoutMapped) {
      this.setRetryAfterHeader(response, loadLevelTimeoutMapped.retryAfterSec);
      recordInboundLoadLevelWaitTimeout503(requestUrl);
      return {
        status: loadLevelTimeoutMapped.status,
        message: loadLevelTimeoutMapped.message,
      };
    }

    const overloadMapped = this.mapOverloadException(exception);
    if (overloadMapped) {
      this.setRetryAfterHeader(response, overloadMapped.retryAfterSec);
      recordInboundBulkhead503(requestUrl);
      return {
        status: overloadMapped.status,
        message: overloadMapped.message,
      };
    }

    return undefined;
  }

  private mapDeadlineException(
    exception: unknown,
  ): { status: number; message: string } | undefined {
    if (exception instanceof RequestDeadlineExceededError) {
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        message: exception.message,
      };
    }

    if (exception instanceof RequestCancelledError) {
      return {
        status: HTTP_STATUS_CLIENT_CLOSED_REQUEST,
        message: exception.message,
      };
    }

    const isAbort =
      (exception instanceof Error && exception.name === 'AbortError') ||
      (typeof DOMException !== 'undefined' &&
        exception instanceof DOMException &&
        exception.name === 'AbortError');

    if (!isAbort) {
      return undefined;
    }

    const reason = getDeadlineReason();
    if (reason === 'client_disconnected') {
      return {
        status: HTTP_STATUS_CLIENT_CLOSED_REQUEST,
        message: 'Request cancelled by client',
      };
    }

    if (reason === 'timeout') {
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        message: 'Request deadline exceeded',
      };
    }

    return undefined;
  }

  private mapPriorityShedException(
    exception: unknown,
  ): { status: number; message: string; retryAfterSec: number } | undefined {
    if (!(exception instanceof PriorityShedRejectedError)) {
      return undefined;
    }
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: exception.message,
      retryAfterSec: resolveOverloadRetryAfterSec(),
    };
  }

  private mapLoadLevelQueueFullException(
    exception: unknown,
  ): { status: number; message: string; retryAfterSec: number } | undefined {
    if (!(exception instanceof LoadLevelQueueFullError)) {
      return undefined;
    }
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: exception.message,
      retryAfterSec: resolveOverloadRetryAfterSec(),
    };
  }

  private mapLoadLevelWaitTimeoutException(
    exception: unknown,
  ): { status: number; message: string; retryAfterSec: number } | undefined {
    if (!(exception instanceof LoadLevelWaitTimeoutError)) {
      return undefined;
    }
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: exception.message,
      retryAfterSec: resolveOverloadRetryAfterSec(),
    };
  }

  private mapOverloadException(
    exception: unknown,
  ): { status: number; message: string; retryAfterSec: number } | undefined {
    if (!(exception instanceof OverloadRejectedError)) {
      return undefined;
    }
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: exception.message,
      retryAfterSec: resolveOverloadRetryAfterSec(),
    };
  }

  private setRetryAfterHeader(response: unknown, retryAfterSec: number): void {
    const value = String(retryAfterSec);
    const res = response as {
      header?: (name: string, headerValue: string) => void;
      setHeader?: (name: string, headerValue: string) => void;
    };
    if (typeof res.header === 'function') {
      res.header('Retry-After', value);
      return;
    }
    if (typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', value);
    }
  }
}
