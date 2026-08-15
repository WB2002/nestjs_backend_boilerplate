import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_KEY } from '../constants/rate-limit.constants';
import { RateLimitDecoratorOptions } from '../types/rate-limit.types';

export const RateLimit = (options: RateLimitDecoratorOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
