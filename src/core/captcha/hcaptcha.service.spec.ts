import { ConfigService } from '@nestjs/config';
import {
  HttpClient,
  HttpError,
  NetworkError,
  TimeoutError,
} from '@/core/http-client';
import {
  CaptchaConfigurationError,
  CaptchaMalformedResponseError,
  CaptchaProviderUnavailableError,
  CaptchaTimeoutError,
} from './captcha.errors';
import { HCaptchaService } from './hcaptcha.service';

describe('HCaptchaService', () => {
  let post: jest.Mock;
  let httpClient: HttpClient;
  let configGet: jest.Mock;

  function createService(
    env: Record<string, string | undefined> = {
      HCAPTCHA_SECRET: 'test-secret',
    },
  ): HCaptchaService {
    configGet = jest.fn((key: string) => env[key]);
    const configService = {
      get: configGet,
    } as unknown as ConfigService;

    post = jest.fn();
    const configured = {
      post,
      addBaseUrl: jest.fn().mockReturnThis(),
      addTimeout: jest.fn().mockReturnThis(),
      addTracing: jest.fn().mockReturnThis(),
      addMetrics: jest.fn().mockReturnThis(),
      addLogging: jest.fn().mockReturnThis(),
    };
    httpClient = {
      external: jest.fn().mockReturnValue(configured),
    } as unknown as HttpClient;

    return new HCaptchaService(configService, httpClient);
  }

  it('verifies successfully', async () => {
    const service = createService();
    post.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: { success: true },
      ok: true,
    });

    const result = await service.verify('valid-token', {
      remoteIp: '203.0.113.10',
    });

    expect(result).toEqual({ success: true });
    expect(post).toHaveBeenCalledWith('/siteverify', undefined, {
      formData: {
        secret: 'test-secret',
        response: 'valid-token',
        remoteip: '203.0.113.10',
      },
    });
  });

  it('returns failed verification with error codes', async () => {
    const service = createService();
    post.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: {
        success: false,
        'error-codes': ['invalid-input-response'],
      },
      ok: true,
    });

    await expect(service.verify('bad-token')).resolves.toEqual({
      success: false,
      errorCodes: ['invalid-input-response'],
    });
  });

  it('returns missing-input-response without calling the provider', async () => {
    const service = createService();

    await expect(service.verify('   ')).resolves.toEqual({
      success: false,
      errorCodes: ['missing-input-response'],
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('maps HTTP 4xx without a captcha body to provider unavailable', async () => {
    const service = createService();
    post.mockRejectedValue(
      new HttpError('HTTP 400', { status: 400, responseBody: 'bad' }),
    );

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      CaptchaProviderUnavailableError,
    );
  });

  it('maps HTTP 5xx to provider unavailable', async () => {
    const service = createService();
    post.mockRejectedValue(
      new HttpError('HTTP 503', { status: 503, responseBody: { error: true } }),
    );

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      CaptchaProviderUnavailableError,
    );
  });

  it('maps network failure to provider unavailable', async () => {
    const service = createService();
    post.mockRejectedValue(new NetworkError('connection reset'));

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      CaptchaProviderUnavailableError,
    );
  });

  it('maps timeout to CaptchaTimeoutError', async () => {
    const service = createService();
    post.mockRejectedValue(new TimeoutError('timed out'));

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      CaptchaTimeoutError,
    );
  });

  it('rejects malformed provider responses', async () => {
    const service = createService();
    post.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: 'not-json-object',
      ok: true,
    });

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      CaptchaMalformedResponseError,
    );
  });

  it('throws CaptchaConfigurationError when secret is missing', () => {
    expect(() => createService({ HCAPTCHA_SECRET: undefined })).toThrow(
      CaptchaConfigurationError,
    );
  });

  it('parses well-formed success:false from an HTTP error body', async () => {
    const service = createService();
    post.mockRejectedValue(
      new HttpError('HTTP 400', {
        status: 400,
        responseBody: {
          success: false,
          'error-codes': ['invalid-input-response'],
        },
      }),
    );

    await expect(service.verify('token')).resolves.toEqual({
      success: false,
      errorCodes: ['invalid-input-response'],
    });
  });
});
