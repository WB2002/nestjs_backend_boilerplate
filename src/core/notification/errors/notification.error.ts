export const NotificationErrorCode = {
  MISSING_CONFIGURATION: 'MISSING_CONFIGURATION',
  TIMEOUT: 'TIMEOUT',
  UNAVAILABLE: 'UNAVAILABLE',
  HTTP_ERROR: 'HTTP_ERROR',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
} as const;

export type NotificationErrorCode =
  (typeof NotificationErrorCode)[keyof typeof NotificationErrorCode];

export class NotificationError extends Error {
  readonly code: NotificationErrorCode;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: {
      code: NotificationErrorCode;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'NotificationError';
    this.code = options.code;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
