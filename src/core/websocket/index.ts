export { WebSocketModule } from './websocket.module';
export { RedisIoAdapter } from './adapters/redis-io.adapter';
export {
  assertWebSocketProductionOrigins,
  parseWebSocketConfig,
} from './config/parse-websocket-config';
export { REALTIME_NAMESPACE } from './config/get-websocket-gateway-options';
export { WebSocketShutdownService } from './websocket-shutdown.service';
