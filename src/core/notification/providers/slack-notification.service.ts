import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HttpClient,
  HttpError,
  NetworkError,
  TimeoutError,
  type ConfiguredHttpClient,
} from '@/core/http-client';
import {
  NotificationError,
  NotificationErrorCode,
} from '../errors/notification.error';
import {
  SLACK_HTTP_SERVICE_NAME,
  SLACK_WEBHOOK_HOST,
  SLACK_WEBHOOK_TIMEOUT_MS,
  SLACK_WEBHOOK_URL_ENV,
} from '../notification.constants';
import type { INotification, INotificationService } from '../types';
import { formatSlackMessageText } from './slack-message.formatter';

interface SlackWebhookTarget {
  readonly origin: string;
  readonly pathWithSearch: string;
}

@Injectable()
export class SlackNotificationService implements INotificationService {
  private readonly logger = new Logger(SlackNotificationService.name);
  private client: ConfiguredHttpClient | undefined;
  private webhookPath: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClient: HttpClient,
  ) {}

  async send(notification: INotification): Promise<void> {
    const { client, webhookPath } = this.getOrCreateClient();
    const text = formatSlackMessageText(notification);

    try {
      const response = await client.post<string>(
        webhookPath,
        { text },
        { responseType: 'text' },
      );

      const body =
        typeof response.body === 'string'
          ? response.body.trim()
          : String(response.body ?? '').trim();

      if (body !== 'ok') {
        this.logger.error({
          message: 'notification failed',
          provider: 'slack',
          reason: 'malformed_response',
          status: response.status,
        });
        throw new NotificationError(
          'Slack returned an unexpected response body',
          { code: NotificationErrorCode.MALFORMED_RESPONSE },
        );
      }

      this.logger.log({
        message: 'notification sent',
        provider: 'slack',
      });
    } catch (error) {
      if (error instanceof NotificationError) {
        throw error;
      }
      throw this.mapHttpFailure(error);
    }
  }

  private getOrCreateClient(): {
    client: ConfiguredHttpClient;
    webhookPath: string;
  } {
    if (this.client != null && this.webhookPath != null) {
      return { client: this.client, webhookPath: this.webhookPath };
    }

    const target = this.resolveWebhookTarget();
    // Do not addLogging/addTracing: webhook path is the secret and is not redacted.
    this.client = this.httpClient
      .external(SLACK_HTTP_SERVICE_NAME)
      .addBaseUrl(target.origin)
      .addTimeout({ timeoutMs: SLACK_WEBHOOK_TIMEOUT_MS })
      .addMetrics();
    this.webhookPath = target.pathWithSearch;
    return { client: this.client, webhookPath: this.webhookPath };
  }

  private resolveWebhookTarget(): SlackWebhookTarget {
    const raw = this.configService.get<string>(SLACK_WEBHOOK_URL_ENV);
    if (raw == null || raw.trim() === '') {
      throw new NotificationError('Slack webhook URL is not configured', {
        code: NotificationErrorCode.MISSING_CONFIGURATION,
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(raw.trim());
    } catch {
      throw new NotificationError('Slack webhook URL is invalid', {
        code: NotificationErrorCode.MISSING_CONFIGURATION,
      });
    }

    if (parsed.protocol !== 'https:') {
      throw new NotificationError('Slack webhook URL must use HTTPS', {
        code: NotificationErrorCode.MISSING_CONFIGURATION,
      });
    }

    if (parsed.hostname.toLowerCase() !== SLACK_WEBHOOK_HOST) {
      throw new NotificationError('Slack webhook host is not allowed', {
        code: NotificationErrorCode.MISSING_CONFIGURATION,
      });
    }

    return {
      origin: parsed.origin,
      pathWithSearch: `${parsed.pathname}${parsed.search}`,
    };
  }

  private mapHttpFailure(error: unknown): NotificationError {
    if (error instanceof TimeoutError) {
      this.logger.error({
        message: 'notification failed',
        provider: 'slack',
        reason: 'timeout',
        errorCode: error.code,
      });
      return new NotificationError('Slack webhook request timed out', {
        code: NotificationErrorCode.TIMEOUT,
        cause: this.sanitizeCause(error),
      });
    }

    if (error instanceof HttpError) {
      this.logger.error({
        message: 'notification failed',
        provider: 'slack',
        reason: 'http_error',
        status: error.status,
        errorCode: error.code,
      });
      return new NotificationError(
        `Slack webhook returned HTTP ${error.status}`,
        {
          code: NotificationErrorCode.HTTP_ERROR,
          cause: this.sanitizeCause(error),
        },
      );
    }

    if (error instanceof NetworkError) {
      this.logger.error({
        message: 'notification failed',
        provider: 'slack',
        reason: 'unavailable',
        errorCode: error.code,
      });
      return new NotificationError('Slack webhook is unavailable', {
        code: NotificationErrorCode.UNAVAILABLE,
        cause: this.sanitizeCause(error),
      });
    }

    this.logger.error({
      message: 'notification failed',
      provider: 'slack',
      reason: 'unavailable',
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return new NotificationError('Slack webhook is unavailable', {
      code: NotificationErrorCode.UNAVAILABLE,
      cause: this.sanitizeCause(error),
    });
  }

  /**
   * Drop URL-bearing metadata and messages so the webhook path token
   * never appears in NotificationError or nested causes we rethrow.
   */
  private sanitizeCause(error: unknown): unknown {
    if (!(error instanceof Error)) {
      return undefined;
    }
    return {
      name: error.name,
      code: 'code' in error ? (error as { code?: string }).code : undefined,
      status:
        'status' in error ? (error as { status?: number }).status : undefined,
    };
  }
}
