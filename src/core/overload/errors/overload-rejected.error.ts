export class OverloadRejectedError extends Error {
  constructor(message = 'Service temporarily unavailable') {
    super(message);
    this.name = 'OverloadRejectedError';
  }
}
