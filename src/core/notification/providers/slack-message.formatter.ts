import type { INotification } from '../types';
import {
  NOTIFICATION_MAX_METADATA_STRING_LENGTH,
  NOTIFICATION_PREFERRED_METADATA_KEYS,
  SENSITIVE_METADATA_KEY_PATTERN,
} from '../notification.constants';

/**
 * Transforms a generic notification into Slack Incoming Webhook `text` (mrkdwn).
 * Callers never see this Slack-specific shape.
 */
export function formatSlackMessageText(notification: INotification): string {
  const lines: string[] = [];

  if (notification.title?.trim()) {
    lines.push(`*${escapeMrkdwn(notification.title.trim())}*`);
    lines.push('');
  }

  lines.push(escapeMrkdwn(notification.message));

  const metadata = notification.metadata;
  if (metadata == null || Object.keys(metadata).length === 0) {
    return lines.join('\n');
  }

  const preferredLines: string[] = [];
  const additionalLines: string[] = [];
  const preferredSet = new Set<string>(NOTIFICATION_PREFERRED_METADATA_KEYS);
  const usedPreferred = new Set<string>();

  for (const key of NOTIFICATION_PREFERRED_METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
      continue;
    }
    if (isSensitiveMetadataKey(key)) {
      continue;
    }
    const value = metadata[key];
    if (value === undefined) {
      continue;
    }
    preferredLines.push(`${labelForPreferredKey(key)}: ${formatMetadataValue(value)}`);
    usedPreferred.add(key);
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (preferredSet.has(key) && usedPreferred.has(key)) {
      continue;
    }
    if (isSensitiveMetadataKey(key)) {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    additionalLines.push(`• ${escapeMrkdwn(key)}: ${formatMetadataValue(value)}`);
  }

  if (preferredLines.length > 0) {
    lines.push('');
    lines.push(...preferredLines);
  }

  if (additionalLines.length > 0) {
    lines.push('');
    lines.push('Additional metadata:');
    lines.push(...additionalLines);
  }

  return lines.join('\n');
}

export function isSensitiveMetadataKey(key: string): boolean {
  return SENSITIVE_METADATA_KEY_PATTERN.test(key);
}

function labelForPreferredKey(key: string): string {
  switch (key) {
    case 'operationId':
      return 'Operation ID';
    case 'userId':
      return 'User ID';
    case 'durationMs':
      return 'Duration (ms)';
    case 'result':
      return 'Result';
    default:
      return key;
  }
}

function formatMetadataValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return escapeMrkdwn(truncate(value));
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return escapeMrkdwn(truncate(JSON.stringify(value)));
  } catch {
    return '[unserializable]';
  }
}

function truncate(value: string): string {
  if (value.length <= NOTIFICATION_MAX_METADATA_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, NOTIFICATION_MAX_METADATA_STRING_LENGTH)}…`;
}

/** Escape characters that alter Slack mrkdwn unexpectedly. */
function escapeMrkdwn(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
