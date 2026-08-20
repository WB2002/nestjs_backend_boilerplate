import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HttpClient,
  HttpError,
  NetworkError,
  TimeoutError,
} from '@/core/http-client';
import {
  NotificationError,
  NotificationErrorCode,
} from '../errors/notification.error';
import { SlackNotificationService } from './slack-notification.service';

const WEBHOOK_URL =
  'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX';
const WEBHOOK_PATH = '/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX';

describe('SlackNotificationService', () => {
  let post: jest.Mock;
  let configGet: jest.Mock;
  let service: SlackNotificationService;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  function createService(webhookUrl: string | undefined): SlackNotificationService {
    configGet = jest.fn().mockImplementation((key: string) => {
      if (key === 'SLACK_WEBHOOK_URL') {
        return webhookUrl;
      }
      return undefined;
    });

    post = jest.fn();
    const configured = {
      addBaseUrl: jest.fn().mockReturnThis(),
      addTimeout: jest.fn().mockReturnThis(),
      addMetrics: jest.fn().mockReturnThis(),
      post,
    };
    const httpClient = {
      external: jest.fn().mockReturnValue(configured),
    } as unknown as HttpClient;

    return new SlackNotificationService(
      { get: configGet } as unknown as ConfigService,
      httpClient,
    );
  }

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    service = createService(WEBHOOK_URL);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function assertNoWebhookLeak(value: unknown): void {
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain(WEBHOOK_URL);
    expect(serialized).not.toContain('XXXXXXXXXXXXXXXXXXXXXXXX');
    expect(serialized).not.toContain('/services/T00000000');
  }

  it('sends a successful Slack request with formatted payload', async () => {
    post.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      body: 'ok',
    });

    await service.send({
      title: 'Operation Completed',
      message: 'Example operation completed successfully',
      metadata: {
        operationId: '123',
        result: 'success',
        extra: 'value',
      },
    });

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] as [string, { text: string }];
    expect(path).toBe(WEBHOOK_PATH);
    expect(body.text).toContain('*Operation Completed*');
    expect(body.text).toContain('Example operation completed successfully');
    expect(body.text).toContain('Operation ID: 123');
    expect(body.text).toContain('Result: success');
    expect(body.text).toContain('Additional metadata:');
    expect(body.text).toContain('extra: value');
    expect(logSpy).toHaveBeenCalled();
    for (const call of logSpy.mock.calls) {
      assertNoWebhookLeak(call);
    }
  });

  it('maps Slack HTTP errors to NotificationError', async () => {
    post.mockRejectedValue(
      new HttpError('HTTP 500 for POST https://hooks.slack.com/services/secret', {
        status: 500,
        metadata: { url: WEBHOOK_URL },
      }),
    );

    await expect(
      service.send({ message: 'hi' }),
    ).rejects.toMatchObject({
      name: 'NotificationError',
      code: NotificationErrorCode.HTTP_ERROR,
    });

    for (const call of errorSpy.mock.calls) {
      assertNoWebhookLeak(call);
    }
  });

  it('maps network failures to UNAVAILABLE', async () => {
    post.mockRejectedValue(
      new NetworkError('connect ECONNREFUSED', {
        metadata: { url: WEBHOOK_URL },
      }),
    );

    await expect(service.send({ message: 'hi' })).rejects.toMatchObject({
      code: NotificationErrorCode.UNAVAILABLE,
    });
  });

  it('maps timeouts to TIMEOUT', async () => {
    post.mockRejectedValue(
      new TimeoutError('Request timed out', {
        metadata: { url: WEBHOOK_URL },
      }),
    );

    await expect(service.send({ message: 'hi' })).rejects.toMatchObject({
      code: NotificationErrorCode.TIMEOUT,
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'timeout' }),
    );
  });

  it('rejects malformed Slack response bodies', async () => {
    post.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      body: 'invalid_token',
    });

    await expect(service.send({ message: 'hi' })).rejects.toMatchObject({
      code: NotificationErrorCode.MALFORMED_RESPONSE,
    });
  });

  it('throws MISSING_CONFIGURATION when webhook is unset', async () => {
    service = createService(undefined);

    await expect(service.send({ message: 'hi' })).rejects.toBeInstanceOf(
      NotificationError,
    );
    await expect(service.send({ message: 'hi' })).rejects.toMatchObject({
      code: NotificationErrorCode.MISSING_CONFIGURATION,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('omits sensitive metadata from the Slack payload', async () => {
    post.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      body: 'ok',
    });

    await service.send({
      message: 'safe',
      metadata: {
        operationId: '123',
        password: 's3cret',
        accessToken: 'tok_abc',
        api_key: 'key_abc',
        result: 'success',
      },
    });

    const body = post.mock.calls[0][1] as { text: string };
    expect(body.text).toContain('Operation ID: 123');
    expect(body.text).not.toContain('s3cret');
    expect(body.text).not.toContain('tok_abc');
    expect(body.text).not.toContain('key_abc');
    expect(body.text).not.toContain('password');
    expect(body.text).not.toContain('accessToken');
  });

  it('never logs the webhook URL', async () => {
    post.mockRejectedValue(
      new HttpError(`HTTP 404 for POST ${WEBHOOK_URL}`, {
        status: 404,
        metadata: { url: WEBHOOK_URL },
      }),
    );

    await expect(service.send({ message: 'hi' })).rejects.toBeDefined();

    for (const call of [...logSpy.mock.calls, ...errorSpy.mock.calls]) {
      assertNoWebhookLeak(call);
    }
  });
});
