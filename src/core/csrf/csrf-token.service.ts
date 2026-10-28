import { Injectable } from '@nestjs/common';
import { csrfTokensMatch, generateCsrfToken } from './helpers/csrf-token';

@Injectable()
export class CsrfTokenService {
  generateToken(): string {
    return generateCsrfToken();
  }

  tokensMatch(
    cookieValue: string | undefined,
    headerValue: string | undefined,
  ): boolean {
    return csrfTokensMatch(cookieValue, headerValue);
  }
}
