import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_WEBSOCKET_MAX_CONNECTIONS_PER_USER,
  DEFAULT_WEBSOCKET_MAX_INBOUND_BUFFER_BYTES,
  DEFAULT_WEBSOCKET_CONNECTION_KEY_TTL_SEC,
  DEFAULT_WEBSOCKET_MESSAGES_PER_MINUTE,
  DEFAULT_WEBSOCKET_PATH,
} from './websocket.constants';
import { WebSocketConfig } from './websocket-config.types';

function parseBoolean(
  value: string | undefined,
  isDefaultOn: boolean,
): boolean {
  if (value === undefined || value === '') {
    return isDefaultOn;
  }
  return value === 'true' || value === '1';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

type CorsOriginsResolveResult =
  | { mode: 'allow-all' }
  | { mode: 'list'; origins: string[] };

function resolveCorsOrigins(
  configService: Pick<ConfigService, 'get'>,
): CorsOriginsResolveResult {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const raw = configService.get<string>('ALLOWED_ORIGINS');
  const origins =
    raw
      ?.split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0) ?? [];

  if (nodeEnv === 'production') {
    return { mode: 'list', origins };
  }

  if (origins.length === 0) {
    return { mode: 'allow-all' };
  }

  return { mode: 'list', origins };
}

export function parseWebSocketConfig(
  configService: Pick<ConfigService, 'get'>,
): WebSocketConfig {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const redisAdapterExplicit = configService.get<string>(
    'WEBSOCKET_REDIS_ADAPTER',
  );
  const isRedisAdapterEnabled =
    redisAdapterExplicit !== undefined && redisAdapterExplicit !== ''
      ? parseBoolean(redisAdapterExplicit, false)
      : nodeEnv === 'production';

  const corsOriginsResolved = resolveCorsOrigins(configService);

  return {
    enabled: parseBoolean(configService.get<string>('WEBSOCKET_ENABLED'), true),
    path:
      configService.get<string>('WEBSOCKET_PATH')?.trim() ||
      DEFAULT_WEBSOCKET_PATH,
    allowQueryToken: parseBoolean(
      configService.get<string>('WEBSOCKET_ALLOW_QUERY_TOKEN'),
      false,
    ),
    redisAdapterEnabled: isRedisAdapterEnabled,
    corsOrigins:
      corsOriginsResolved.mode === 'allow-all'
        ? true
        : corsOriginsResolved.origins,
    maxConnectionsPerUser: parsePositiveInt(
      configService.get<string>('WEBSOCKET_MAX_CONNECTIONS_PER_USER'),
      DEFAULT_WEBSOCKET_MAX_CONNECTIONS_PER_USER,
    ),
    maxInboundBufferBytes: parsePositiveInt(
      configService.get<string>('WEBSOCKET_MAX_INBOUND_BUFFER_BYTES'),
      DEFAULT_WEBSOCKET_MAX_INBOUND_BUFFER_BYTES,
    ),
    messagesPerMinute: parsePositiveInt(
      configService.get<string>('WEBSOCKET_MESSAGES_PER_MINUTE'),
      DEFAULT_WEBSOCKET_MESSAGES_PER_MINUTE,
    ),
    connectionKeyTtlSec: parsePositiveInt(
      configService.get<string>('WEBSOCKET_CONNECTION_KEY_TTL_SEC'),
      DEFAULT_WEBSOCKET_CONNECTION_KEY_TTL_SEC,
    ),
  };
}

export function assertWebSocketProductionOrigins(
  config: WebSocketConfig,
  nodeEnv: string,
): void {
  if (!config.enabled || nodeEnv !== 'production') {
    return;
  }
  if (Array.isArray(config.corsOrigins) && config.corsOrigins.length === 0) {
    throw new Error(
      'ALLOWED_ORIGINS is required for WebSocket when NODE_ENV=production',
    );
  }
}
