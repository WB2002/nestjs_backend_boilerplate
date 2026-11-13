import { Controller, Get } from '@nestjs/common';
import { Public } from '@/common/decorators';
import {
  RateLimit,
  RateLimitAlgorithm,
  RateLimitIdentifier,
} from '@/core/rate-limiter';

export type ConformanceRateLimitIdentifierKind =
  | 'user'
  | 'fingerprint'
  | 'guest';

export interface ConformanceRateLimitResponse {
  identifierKind: ConformanceRateLimitIdentifierKind;
}

@Controller('conformance/rate-limit')
export class ConformanceRateLimitController {
  @Get('user')
  @RateLimit({
    algorithm: RateLimitAlgorithm.FixedWindowCounter,
    methods: [
      {
        name: 'conformance-user',
        identifier: RateLimitIdentifier.UserId,
        duration: 60_000,
        limit: 3,
      },
    ],
  })
  user(): ConformanceRateLimitResponse {
    return { identifierKind: 'user' };
  }

  @Public()
  @Get('fingerprint')
  @RateLimit({
    algorithm: RateLimitAlgorithm.FixedWindowCounter,
    methods: [
      {
        name: 'conformance-fingerprint',
        identifier: RateLimitIdentifier.DeviceFingerprint,
        duration: 60_000,
        limit: 3,
      },
    ],
  })
  fingerprint(): ConformanceRateLimitResponse {
    return { identifierKind: 'fingerprint' };
  }

  @Public()
  @Get('guest')
  @RateLimit({
    algorithm: RateLimitAlgorithm.FixedWindowCounter,
    methods: [
      {
        name: 'conformance-guest',
        identifier: RateLimitIdentifier.GuestId,
        duration: 60_000,
        limit: 3,
      },
    ],
  })
  guest(): ConformanceRateLimitResponse {
    return { identifierKind: 'guest' };
  }
}
