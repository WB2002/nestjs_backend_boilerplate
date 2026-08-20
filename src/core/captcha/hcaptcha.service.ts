import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isPlainObject, isString } from 'lodash';
import {
  ConfiguredHttpClient,
  HttpClient,
  HttpError,
  NetworkError,
  TimeoutError,
} from '@/core/http-client';
import {
  HCAPTCHA_DEFAULT_VERIFY_BASE_URL,
  HCAPTCHA_SITEVERIFY_PATH,
  HCAPTCHA_VERIFY_TIMEOUT_MS,
} from './captcha.constants';
import {
  CaptchaConfigurationError,
  CaptchaMalformedResponseError,
  CaptchaProviderUnavailableError,
  CaptchaTimeoutError,
} from './captcha.errors';
import { CaptchaService } from './captcha.service';
import {
  CaptchaVerificationOptions,
  CaptchaVerificationResult,
} from './captcha.types';

@Injectable()
export class HCaptchaService extends CaptchaService {
  private readonly logger = new Logger(HCaptchaService.name);
  private readonly secret: string;
  private readonly client: ConfiguredHttpClient;

  constructor(
    private readonly configService: ConfigService,
    httpClient: HttpClient,
  ) {
    super();

    const secret = this.configService.get<string>('HCAPTCHA_SECRET')?.trim();
    if (!secret) {
      throw new CaptchaConfigurationError('HCAPTCHA_SECRET is not configured');
    }
    this.secret = secret;

    const configuredBaseUrl = this.configService
      .get<string>('HCAPTCHA_VERIFY_BASE_URL')
      ?.trim();
    const baseUrl = configuredBaseUrl || HCAPTCHA_DEFAULT_VERIFY_BASE_URL;

    this.client = httpClient
      .external('hcaptcha')
      .addBaseUrl(baseUrl)
      .addTimeout({
        timeoutMs: HCAPTCHA_VERIFY_TIMEOUT_MS,
        totalTimeoutMs: HCAPTCHA_VERIFY_TIMEOUT_MS,
      })
      .addTracing()
      .addMetrics()
      .addLogging();
  }

  async verify(
    token: string,
    options?: CaptchaVerificationOptions,
  ): Promise<CaptchaVerificationResult> {
    const trimmedToken = isString(token) ? token.trim() : '';
    if (!trimmedToken) {
      const result: CaptchaVerificationResult = {
        success: false,
        errorCodes: ['missing-input-response'],
      };
      this.logger.warn({
        message: 'verification_failed',
        errorCodes: result.errorCodes,
      });
      return result;
    }

    const formData: Record<string, string> = {
      secret: this.secret,
      response: trimmedToken,
    };
    const remoteIp = options?.remoteIp?.trim();
    if (remoteIp) {
      formData.remoteip = remoteIp;
    }

    try {
      const response = await this.client.post<unknown>(
        HCAPTCHA_SITEVERIFY_PATH,
        undefined,
        { formData },
      );
      const result = this.normalizeResponse(response.body);
      this.logVerificationOutcome(result);
      return result;
    } catch (error) {
      if (
        error instanceof CaptchaMalformedResponseError ||
        error instanceof CaptchaTimeoutError ||
        error instanceof CaptchaProviderUnavailableError ||
        error instanceof CaptchaConfigurationError
      ) {
        throw error;
      }
      return this.mapHttpClientError(error);
    }
  }

  private normalizeResponse(body: unknown): CaptchaVerificationResult {
    if (!isPlainObject(body)) {
      this.logger.warn({ message: 'provider_failure', reason: 'malformed' });
      throw new CaptchaMalformedResponseError();
    }

    const record = body as Record<string, unknown>;
    if (typeof record.success !== 'boolean') {
      this.logger.warn({ message: 'provider_failure', reason: 'malformed' });
      throw new CaptchaMalformedResponseError();
    }

    const result: CaptchaVerificationResult = { success: record.success };
    const rawCodes = record['error-codes'];
    if (Array.isArray(rawCodes)) {
      const errorCodes = rawCodes.filter(isString);
      if (errorCodes.length > 0) {
        result.errorCodes = errorCodes;
      }
    }
    return result;
  }

  private mapHttpClientError(error: unknown): CaptchaVerificationResult {
    if (error instanceof TimeoutError) {
      this.logger.warn({ message: 'timeout' });
      throw new CaptchaTimeoutError();
    }

    if (error instanceof HttpError) {
      const parsed = this.tryParseResult(error.responseBody);
      if (parsed) {
        this.logVerificationOutcome(parsed);
        return parsed;
      }
      this.logger.warn({
        message: 'provider_failure',
        status: error.status,
      });
      throw new CaptchaProviderUnavailableError();
    }

    if (error instanceof NetworkError) {
      this.logger.warn({ message: 'provider_failure', reason: 'network' });
      throw new CaptchaProviderUnavailableError();
    }

    this.logger.warn({ message: 'provider_failure', reason: 'unknown' });
    throw new CaptchaProviderUnavailableError();
  }

  private tryParseResult(
    body: unknown,
  ): CaptchaVerificationResult | undefined {
    if (!isPlainObject(body)) {
      return undefined;
    }
    const record = body as Record<string, unknown>;
    if (typeof record.success !== 'boolean') {
      return undefined;
    }
    const result: CaptchaVerificationResult = { success: record.success };
    const rawCodes = record['error-codes'];
    if (Array.isArray(rawCodes)) {
      const errorCodes = rawCodes.filter(isString);
      if (errorCodes.length > 0) {
        result.errorCodes = errorCodes;
      }
    }
    return result;
  }

  private logVerificationOutcome(result: CaptchaVerificationResult): void {
    if (result.success) {
      this.logger.log({ message: 'verification_success' });
      return;
    }
    this.logger.warn({
      message: 'verification_failed',
      ...(result.errorCodes !== undefined
        ? { errorCodes: result.errorCodes }
        : {}),
    });
  }
}
