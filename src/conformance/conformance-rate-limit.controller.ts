import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConformanceHarnessAuthGuard } from './guards/conformance-harness-auth.guard';
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

/** Read-only harness probes for rate-limit identifiers. */
@UseGuards(ConformanceHarnessAuthGuard)
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
