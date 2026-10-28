import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { WsHandshakeService } from './auth/ws-handshake.service';
import { WsAuthenticatedGuard } from './guards/ws-authenticated.guard';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';
import { WsMessageRateLimiterGuard } from './guards/ws-message-rate-limiter.guard';
import { WsRolesGuard } from './guards/ws-roles.guard';
import { WsConnectionLimiterService } from './rate-limit/ws-connection-limiter.service';
import { WebSocketShutdownService } from './websocket-shutdown.service';

@Module({
  imports: [AuthModule],
  providers: [
    WsHandshakeService,
    WsJwtAuthGuard,
    WsAuthenticatedGuard,
    WsRolesGuard,
    WsConnectionLimiterService,
    WsMessageRateLimiterGuard,
    WebSocketShutdownService,
  ],
  exports: [
    WsHandshakeService,
    WsJwtAuthGuard,
    WsAuthenticatedGuard,
    WsRolesGuard,
    WsConnectionLimiterService,
    WsMessageRateLimiterGuard,
    WebSocketShutdownService,
  ],
})
export class WebSocketModule {}
