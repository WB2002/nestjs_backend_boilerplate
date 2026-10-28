import {
  ForbiddenException,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { UserRole } from '@/auth/constants';
import { WsHandshakeService } from '@/core/websocket/auth/ws-handshake.service';
import { REALTIME_NAMESPACE } from '@/core/websocket/config/get-websocket-gateway-options';
import { WsRequireRoles } from '@/core/websocket/decorators/ws-require-roles.decorator';
import { WsAuthenticatedGuard } from '@/core/websocket/guards/ws-authenticated.guard';
import { WsMessageRateLimiterGuard } from '@/core/websocket/guards/ws-message-rate-limiter.guard';
import { WsRolesGuard } from '@/core/websocket/guards/ws-roles.guard';
import { WsConnectionLimiterService } from '@/core/websocket/rate-limit/ws-connection-limiter.service';
import { AuthenticatedSocket } from '@/core/websocket/types/authenticated-socket.types';
import { WebSocketShutdownService } from '@/core/websocket/websocket-shutdown.service';
import { ExampleRealtimeMessageDto } from './dto/example-realtime-message.dto';

@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
@UseGuards(WsAuthenticatedGuard, WsMessageRateLimiterGuard)
export class ExampleRealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly handshake: WsHandshakeService,
    private readonly connectionLimiter: WsConnectionLimiterService,
    private readonly webSocketShutdown: WebSocketShutdownService,
  ) {}

  afterInit(server: Server): void {
    this.webSocketShutdown.registerServer(server);
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      await this.handshake.acceptConnection(client);
    } catch {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    const user = client.data.user;
    if (!user) {
      return;
    }
    await this.connectionLimiter.releaseConnection(user.id, client.id);
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { room?: string },
  ) {
    const user = client.data.user;
    if (!user) {
      throw new UnauthorizedException();
    }
    const allowedRoom = `user:${user.id}`;
    if (body?.room !== allowedRoom) {
      throw new ForbiddenException('Cannot join foreign room');
    }
    void client.join(allowedRoom);
    return { ok: true, room: allowedRoom };
  }

  @SubscribeMessage('message')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: ExampleRealtimeMessageDto,
  ) {
    const user = client.data.user;
    if (!user) {
      throw new UnauthorizedException();
    }
    this.server.to(`user:${user.id}`).emit('message', {
      text: dto.text,
      from: user.id,
    });
  }

  @SubscribeMessage('admin-broadcast')
  @UseGuards(WsRolesGuard)
  @WsRequireRoles(UserRole.ADMIN)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  handleAdminBroadcast(@MessageBody() dto: ExampleRealtimeMessageDto) {
    this.server.emit('admin-broadcast', { text: dto.text });
  }
}
