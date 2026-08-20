export interface CaptchaVerificationOptions {
  remoteIp?: string;
}

export interface CaptchaVerificationResult {
  success: boolean;
  errorCodes?: string[];
}
