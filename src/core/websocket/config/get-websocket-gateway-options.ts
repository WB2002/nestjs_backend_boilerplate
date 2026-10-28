import { GatewayMetadata } from '@nestjs/websockets';
import { WebSocketConfig } from './websocket-config.types';

export const REALTIME_NAMESPACE = '/realtime';

export function getWebSocketGatewayOptions(
  config: WebSocketConfig,
): GatewayMetadata {
  return {
    namespace: REALTIME_NAMESPACE,
    path: config.path,
    cors: {
      origin: config.corsOrigins,
      credentials: true,
    },
    maxHttpBufferSize: config.maxInboundBufferBytes,
  };
}
