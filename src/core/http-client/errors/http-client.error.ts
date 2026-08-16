import { HttpClientErrorMetadata } from '../types/http-client-error-metadata.types';

export type { HttpClientErrorMetadata };

export class HttpClientError extends Error {
  readonly code: string;
  readonly metadata: HttpClientErrorMetadata;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: {
      code: string;
      cause?: unknown;
      metadata?: HttpClientErrorMetadata;
    },
  ) {
    super(message);
    this.name = 'HttpClientError';
    this.code = options.code;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    this.metadata = options.metadata ?? {};
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NetworkError extends HttpClientError {
  constructor(
    message: string,
    options: { cause?: unknown; metadata?: HttpClientErrorMetadata } = {},
  ) {
    super(message, { code: 'NETWORK_ERROR', ...options });
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends HttpClientError {
  constructor(
    message: string,
    options: { cause?: unknown; metadata?: HttpClientErrorMetadata } = {},
  ) {
    super(message, { code: 'TIMEOUT_ERROR', ...options });
    this.name = 'TimeoutError';
  }
}

export class HttpError extends HttpClientError {
  readonly status: number;
  readonly responseBody?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      responseBody?: unknown;
      cause?: unknown;
      metadata?: HttpClientErrorMetadata;
    },
  ) {
    super(message, {
      code: 'HTTP_ERROR',
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      metadata: { ...options.metadata, status: options.status },
    });
    this.name = 'HttpError';
    this.status = options.status;
    if (options.responseBody !== undefined) {
      this.responseBody = options.responseBody;
    }
  }
}

export class CircuitOpenError extends HttpClientError {
  constructor(
    message: string,
    options: { cause?: unknown; metadata?: HttpClientErrorMetadata } = {},
  ) {
    super(message, { code: 'CIRCUIT_OPEN', ...options });
    this.name = 'CircuitOpenError';
  }
}

export class RetryExhaustedError extends HttpClientError {
  constructor(
    message: string,
    options: { cause?: unknown; metadata?: HttpClientErrorMetadata } = {},
  ) {
    super(message, { code: 'RETRY_EXHAUSTED', ...options });
    this.name = 'RetryExhaustedError';
  }
}

export class RequestAbortedError extends HttpClientError {
  constructor(
    message: string,
    options: { cause?: unknown; metadata?: HttpClientErrorMetadata } = {},
  ) {
    super(message, { code: 'REQUEST_ABORTED', ...options });
    this.name = 'RequestAbortedError';
  }
}

export class ClientClosedError extends HttpClientError {
  constructor(
    message = 'HttpClient is closed',
    options: { cause?: unknown; metadata?: HttpClientErrorMetadata } = {},
  ) {
    super(message, { code: 'CLIENT_CLOSED', ...options });
    this.name = 'ClientClosedError';
  }
}
