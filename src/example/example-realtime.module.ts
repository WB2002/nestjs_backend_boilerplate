import { Module } from '@nestjs/common';
import { WebSocketModule } from '@/core/websocket/websocket.module';
import { ExampleRealtimeGateway } from './example-realtime.gateway';

@Module({
  imports: [WebSocketModule],
  providers: [ExampleRealtimeGateway],
})
export class ExampleRealtimeModule {}
