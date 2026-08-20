export const NOTIFICATION_SERVICE = Symbol('NOTIFICATION_SERVICE');

export const SLACK_WEBHOOK_URL_ENV = 'SLACK_WEBHOOK_URL';

export const SLACK_WEBHOOK_TIMEOUT_MS = 5_000;

export const SLACK_WEBHOOK_HOST = 'hooks.slack.com';

export const SLACK_HTTP_SERVICE_NAME = 'slack-incoming-webhook';

/** Preferred metadata keys rendered as labeled lines in Slack messages. */
export const NOTIFICATION_PREFERRED_METADATA_KEYS = [
  'operationId',
  'userId',
  'durationMs',
  'result',
] as const;

export const NOTIFICATION_MAX_METADATA_STRING_LENGTH = 200;

/**
 * Metadata keys matching these patterns are omitted from Slack payloads.
 * Do not send passwords, tokens, secrets, or credentials.
 */
export const SENSITIVE_METADATA_KEY_PATTERN =
  /(password|passwd|token|secret|captcha|credential|authorization|auth|api[_-]?key|private[_-]?key)/i;
