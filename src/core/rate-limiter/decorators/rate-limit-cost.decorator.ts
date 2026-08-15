import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_COST_KEY } from '../constants/rate-limit.constants';

export const RateLimitCost = (cost: number) => SetMetadata(RATE_LIMIT_COST_KEY, cost);
