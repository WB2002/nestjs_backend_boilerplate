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

    // Handle Database Connection Errors (type-safe: no assertion to any)
    const exceptionObj = isPlainObject(exception) ? exception : {};
    const exceptionName = get(exceptionObj, 'name');
    const rawMessage = get(exceptionObj, 'message');
    const exceptionMessage = isString(rawMessage) ? rawMessage : '';
    const isDbConnectionError =
      exceptionName === 'MongooseServerSelectionError' ||
      exceptionName === 'MongoNetworkError' ||
      exceptionMessage.includes('buffering timed out');

    if (isDbConnectionError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Service temporarily unavailable';
    }

    const deadlineMapped = this.mapDeadlineException(exception);
    if (deadlineMapped) {
      status = deadlineMapped.status;
      message = deadlineMapped.message;
    }

    const responseDestroyed =
      get(response, 'raw.destroyed') === true ||
      get(response, 'destroyed') === true ||
      get(response, 'writableEnded') === true ||
      get(response, 'raw.writableEnded') === true;

    if (status === HTTP_STATUS_CLIENT_CLOSED_REQUEST && responseDestroyed) {
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
}
