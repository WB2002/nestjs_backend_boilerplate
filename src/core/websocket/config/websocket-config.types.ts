export type WebSocketConfig = {
  enabled: boolean;
  path: string;
  allowQueryToken: boolean;
  redisAdapterEnabled: boolean;
  corsOrigins: string[] | boolean;
  maxConnectionsPerUser: number;
  maxInboundBufferBytes: number;
  messagesPerMinute: number;
  connectionKeyTtlSec: number;
};
