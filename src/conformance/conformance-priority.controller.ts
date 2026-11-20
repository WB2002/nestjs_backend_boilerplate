import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConformanceHarnessAuthGuard } from './guards/conformance-harness-auth.guard';
import { ApiPriority, ApiPriorityLevel } from '@/core/overload';
import { getRequestSignal, throwIfAborted } from '@/core/request-deadline';
import { ConformancePriorityQueryDto } from './dto';
import { waitForDelayOrAbort } from './wait-for-delay-or-abort';

export type ConformancePriorityLevelName =
  | 'critical'
  | 'high'
  | 'normal'
  | 'low';

export interface ConformancePriorityResponse {
  priority: ConformancePriorityLevelName;
}

@UseGuards(ConformanceHarnessAuthGuard)
@Controller('conformance/priority')
export class ConformancePriorityController {
  @Get('critical')
  @ApiPriority(ApiPriorityLevel.Critical)
  async critical(
    @Query() query: ConformancePriorityQueryDto,
  ): Promise<ConformancePriorityResponse> {
    await this.hold(query);
    return { priority: 'critical' };
  }

  @Get('high')
  @ApiPriority(ApiPriorityLevel.High)
  async high(
    @Query() query: ConformancePriorityQueryDto,
  ): Promise<ConformancePriorityResponse> {
    await this.hold(query);
    return { priority: 'high' };
  }

  @Get('normal')
  @ApiPriority(ApiPriorityLevel.Normal)
  async normal(
    @Query() query: ConformancePriorityQueryDto,
  ): Promise<ConformancePriorityResponse> {
    await this.hold(query);
    return { priority: 'normal' };
  }

  @Get('low')
  @ApiPriority(ApiPriorityLevel.Low)
  async low(
    @Query() query: ConformancePriorityQueryDto,
  ): Promise<ConformancePriorityResponse> {
    await this.hold(query);
    return { priority: 'low' };
  }

  private async hold(query: ConformancePriorityQueryDto): Promise<void> {
    const holdMs = query.holdMs ?? 0;
    try {
      await waitForDelayOrAbort(holdMs, getRequestSignal());
    } finally {
      throwIfAborted();
    }
  }
}
