import { Logger } from '@nestjs/common';
import type { ClientIdentity, HttpRequest, HttpResponse } from '../types';
import { redactHeaders, redactQuery, redactUrl } from './redaction';

const logger = new Logger('HttpClient');

export function logRequestStart(
  isLoggingEnabled: boolean,
  identity: ClientIdentity,
  request: HttpRequest,
  requestId: string,
): void {
  if (!isLoggingEnabled) {
    return;
  }
  logger.log({
    message: 'HTTP request start',
    requestId,
    kind: identity.kind,
    serviceName: identity.serviceName,
    method: request.method,
    url: redactUrl(request.url),
    headers: redactHeaders(request.headers),
    query: redactQuery(request.query as Record<string, unknown> | undefined),
  });
}

export function logRequestSuccess(
  isLoggingEnabled: boolean,
  identity: ClientIdentity,
  request: HttpRequest,
  response: HttpResponse,
  requestId: string,
  latencyMs: number,
  attempts: number,
): void {
  if (!isLoggingEnabled) {
    return;
  }
  logger.log({
    message: 'HTTP request success',
    requestId,
    kind: identity.kind,
    serviceName: identity.serviceName,
    method: request.method,
    url: redactUrl(request.url),
    status: response.status,
    latencyMs,
    attempts,
  });
}

export function logRequestFailure(
  isLoggingEnabled: boolean,
  identity: ClientIdentity,
  request: HttpRequest,
  error: unknown,
  requestId: string,
  latencyMs: number,
  attempts: number,
): void {
  if (!isLoggingEnabled) {
    return;
  }
  logger.error({
    message: 'HTTP request failure',
    requestId,
    kind: identity.kind,
    serviceName: identity.serviceName,
    method: request.method,
    url: redactUrl(request.url),
    latencyMs,
    attempts,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message }
        : String(error),
  });
}
