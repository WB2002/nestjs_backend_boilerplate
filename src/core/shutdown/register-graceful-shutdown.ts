import { INestApplication, Logger } from '@nestjs/common';
import { ShutdownState } from './shutdown-state.service';

export type GracefulShutdownDeps = {
  drainMs: number;
  forceMs: number;
  sleep?: (ms: number) => Promise<void>;
  onExit?: (code: number) => void;
  /** Register signal listeners; defaults to process.on for SIGTERM/SIGINT. */
  onSignal?: (signal: NodeJS.Signals, listener: () => void) => void;
  /**
   * Optional hook after the drain window and before app.close().
   * Use to abort hung dependency sockets (e.g. mongoose.connection.destroy()).
   */
  beforeClose?: () => void | Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Registers SIGTERM/SIGINT handlers that mark readiness down, wait for an ALB
 * drain window, then close the Nest app. Does not use enableShutdownHooks so
 * the drain delay happens before close.
 */
export function registerGracefulShutdown(
  app: Pick<INestApplication, 'close'>,
  shutdownState: ShutdownState,
  deps: GracefulShutdownDeps,
): void {
  const logger = new Logger('GracefulShutdown');
  const sleep = deps.sleep ?? defaultSleep;
  const onExit = deps.onExit ?? ((code: number) => process.exit(code));
  const onSignal =
    deps.onSignal ??
    ((signal: NodeJS.Signals, listener: () => void) => {
      process.on(signal, listener);
    });

  const { drainMs, forceMs } = deps;
  let shuttingDown = false;

  const handle = async (signal: string) => {
    if (shuttingDown) {
      logger.warn(`Ignoring duplicate ${signal} during shutdown`);
      return;
    }
    shuttingDown = true;
    logger.log(
      `Received ${signal}; marking not ready, draining ${drainMs}ms, then closing`,
    );
    shutdownState.beginShutdown();

    const forceTimer = setTimeout(() => {
      logger.error(`Forced exit after ${drainMs + forceMs}ms (close hung)`);
      onExit(1);
    }, drainMs + forceMs);
    forceTimer.unref?.();

    try {
      await sleep(drainMs);
      if (deps.beforeClose) {
        await deps.beforeClose();
      }
      await app.close();
      clearTimeout(forceTimer);
      onExit(0);
    } catch (err) {
      clearTimeout(forceTimer);
      logger.error(
        `Shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      onExit(1);
    }
  };

  onSignal('SIGTERM', () => {
    void handle('SIGTERM');
  });
  onSignal('SIGINT', () => {
    void handle('SIGINT');
  });
}
