import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConformancePriorityQueryDto } from './dto';
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

/** Harness rate-limit probes; query DTOs use class-validator where applicable. */
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
  user(
    @Query() _query: ConformancePriorityQueryDto,
  ): ConformanceRateLimitResponse {
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
  fingerprint(
    @Query() _query: ConformancePriorityQueryDto,
  ): ConformanceRateLimitResponse {
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
  guest(
    @Query() _query: ConformancePriorityQueryDto,
  ): ConformanceRateLimitResponse {
    return { identifierKind: 'guest' };
  }
}
