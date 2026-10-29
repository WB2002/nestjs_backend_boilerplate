import { Injectable } from '@nestjs/common';

@Injectable()
export class ShutdownState {
  private isShutdownInProgress = false;

  get isShuttingDown(): boolean {
    return this.isShutdownInProgress;
  }

  beginShutdown(): void {
    this.isShutdownInProgress = true;
  }
}
