import {
  FEATURE_FLAG_EVENTS_CHANNEL,
  FEATURE_FLAG_KEY_PREFIX,
} from './constants';

export function featureFlagKey(environment: string, key: string): string {
  return `${FEATURE_FLAG_KEY_PREFIX}:${environment}:${key}`;
}

export function featureFlagIndexKey(environment: string): string {
  return `${FEATURE_FLAG_KEY_PREFIX}:index:${environment}`;
}

export function featureFlagEventsChannel(): string {
  return FEATURE_FLAG_EVENTS_CHANNEL;
}
