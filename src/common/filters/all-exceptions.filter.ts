
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { v4 as uuidv4 } from 'uuid';
import { isString, get } from 'lodash';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost) {
    // In certain situations `httpAdapter` might not be available in the constructor during instantiation,
    // so we should resolve it here.
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const res =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const message = isString(res)
      ? res
      : get(res, 'message', JSON.stringify(res));

    const stack = exception instanceof Error ? exception.stack : '';
    this.logger.error(
      `Exception ${status} - ${message}`,
      stack,
    );

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(ctx.getRequest()),
      requestId: get(ctx.getRequest(), 'headers.x-request-id') || uuidv4(),
      message,
    };
    
    httpAdapter.reply(ctx.getResponse(), errorResponse, status);
  }
}
