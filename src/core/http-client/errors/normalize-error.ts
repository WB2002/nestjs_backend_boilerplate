import { AxiosError, isAxiosError } from 'axios';
import {
  HttpClientError,
  HttpClientErrorMetadata,
  HttpError,
  NetworkError,
  RequestAbortedError,
  TimeoutError,
} from './http-client.error';
import { redactUrl } from '../telemetry/redaction';
import { withoutUndefined } from '../utils/without-undefined';

export function normalizeError(
  error: unknown,
  metadata: HttpClientErrorMetadata = {},
): HttpClientError {
  if (error instanceof HttpClientError) {
    return error;
  }

  if (isAxiosError(error)) {
    return normalizeAxiosError(error, metadata);
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.message.includes('aborted')) {
      return new RequestAbortedError(error.message, { cause: error, metadata });
    }
    if (error.name === 'TimeoutError' || /timeout/i.test(error.message)) {
      return new TimeoutError(error.message, { cause: error, metadata });
    }
    return new NetworkError(error.message, { cause: error, metadata });
  }

  return new NetworkError('Unknown HTTP client error', {
    cause: error,
    metadata,
  });
}

function normalizeAxiosError(
  error: AxiosError,
  metadata: HttpClientErrorMetadata,
): HttpClientError {
  const code = error.code;
  const status = error.response?.status;
  const method = (error.config?.method ?? metadata.method)?.toUpperCase();
  const rawUrl = error.config?.url ?? metadata.url;
  const url = rawUrl != null ? redactUrl(rawUrl) : undefined;

  const nextMeta: HttpClientErrorMetadata = {
    ...metadata,
    ...withoutUndefined({ method, url, status }),
  };

  if (error.response) {
    return new HttpError(
      `HTTP ${status} for ${method ?? 'REQUEST'} ${url ?? ''}`.trim(),
      {
        status: status ?? 0,
        responseBody: error.response.data,
        cause: error,
        metadata: nextMeta,
      },
    );
  }

  if (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    /timeout/i.test(error.message)
  ) {
    return new TimeoutError(error.message || 'Request timed out', {
      cause: error,
      metadata: nextMeta,
    });
  }

  if (code === 'ERR_CANCELED' || error.message === 'canceled') {
    return new RequestAbortedError(error.message || 'Request aborted', {
      cause: error,
      metadata: nextMeta,
    });
  }

  return new NetworkError(error.message || 'Network error', {
    cause: error,
    metadata: nextMeta,
  });
}
