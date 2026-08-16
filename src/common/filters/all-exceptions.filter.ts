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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): unknown {
    const isGql = host.getType<GqlContextType>() === 'graphql';
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

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

    this.logger.error(`Exception ${status} - ${message}`, stack);

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
          path: httpAdapter.getRequestUrl(ctx.getRequest()),
          requestId: get(ctx.getRequest(), 'headers.x-request-id') || uuidv4(),
          ...(res as object),
        }
      : {
          statusCode: status,
          timestamp: new Date().toISOString(),
          path: httpAdapter.getRequestUrl(ctx.getRequest()),
          requestId: get(ctx.getRequest(), 'headers.x-request-id') || uuidv4(),
          message,
        };

    httpAdapter.reply(ctx.getResponse(), errorResponse, status);
    return undefined;
  }
}