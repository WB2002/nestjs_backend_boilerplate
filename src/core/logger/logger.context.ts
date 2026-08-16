import { AsyncLocalStorage } from 'async_hooks';
import { ILoggerContext } from '@/types';

export class LoggerContext {
  private static readonly storage = new AsyncLocalStorage<ILoggerContext>();

  static run(context: ILoggerContext, callback: () => void) {
    return this.storage.run(context, callback);
  }

  static get(): ILoggerContext {
    return this.storage.getStore() || {};
  }
}
