import { ForbiddenException } from '@nestjs/common';

export class CsrfForbiddenError extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      message: 'CSRF token invalid or missing',
      error: 'Forbidden',
      code: 'CSRF_VALIDATION_FAILED',
    });
  }
}
