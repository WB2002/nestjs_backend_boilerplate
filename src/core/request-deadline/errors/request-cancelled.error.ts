export class RequestCancelledError extends Error {
  readonly code = 'REQUEST_CANCELLED' as const;

  constructor(message = 'Request cancelled by client') {
    super(message);
    this.name = 'RequestCancelledError';
  }
}
