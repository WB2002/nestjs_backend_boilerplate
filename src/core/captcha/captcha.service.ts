import {
  CaptchaVerificationOptions,
  CaptchaVerificationResult,
} from './captcha.types';

/**
 * Provider-agnostic CAPTCHA verification. Feature modules depend on this
 * abstraction so the concrete provider (e.g. hCaptcha) can be swapped later.
 */
export abstract class CaptchaService {
  abstract verify(
    token: string,
    options?: CaptchaVerificationOptions,
  ): Promise<CaptchaVerificationResult>;
}
