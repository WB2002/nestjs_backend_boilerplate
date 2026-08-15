import { ConsumeContext, ConsumeResult } from './rate-limit.types';

export interface RateLimitBackend {
  consume(context: ConsumeContext): Promise<ConsumeResult>;
  /** Optional cleanup (e.g. Redis connection). */
  quit?(): Promise<void>;
}
