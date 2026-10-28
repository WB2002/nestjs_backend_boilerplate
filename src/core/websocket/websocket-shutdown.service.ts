import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class WebSocketShutdownService {
  private readonly logger = new Logger(WebSocketShutdownService.name);
  private server?: Server;

  registerServer(server: Server): void {
    this.server = server;
  }

  async closeAll(): Promise<void> {
    if (!this.server) {
      return;
    }

    this.logger.log('Disconnecting WebSocket clients before shutdown');
    this.server.local.disconnectSockets(true);
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
  }
}
