export class RequestDeadlineExceededError extends Error {
  readonly code = 'REQUEST_DEADLINE_EXCEEDED' as const;

  constructor(message = 'Request deadline exceeded') {
    super(message);
    this.name = 'RequestDeadlineExceededError';
  }
}
