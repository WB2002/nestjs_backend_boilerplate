export class CaptchaConfigurationError extends Error {
  constructor(message = 'Captcha is not configured') {
    super(message);
    this.name = 'CaptchaConfigurationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CaptchaTimeoutError extends Error {
  constructor(message = 'Captcha verification timed out') {
    super(message);
    this.name = 'CaptchaTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CaptchaProviderUnavailableError extends Error {
  constructor(message = 'Captcha provider unavailable') {
    super(message);
    this.name = 'CaptchaProviderUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CaptchaMalformedResponseError extends Error {
  constructor(message = 'Captcha provider returned a malformed response') {
    super(message);
    this.name = 'CaptchaMalformedResponseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
