import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '@/common/decorators';
import {
  getRequestSignal,
  remainingMs,
  throwIfAborted,
} from '@/core/request-deadline';
import { ConformanceDeadlineQueryDto } from './dto';
import { waitForDelayOrAbort } from './wait-for-delay-or-abort';

export interface ConformanceDeadlineResponse {
  completedAfterMs: number;
  remainingBudgetMs: number | null;
}

@Public()
@Controller('conformance/deadline')
export class ConformanceDeadlineController {
  @Get('slow')
  async slow(
    @Query() query: ConformanceDeadlineQueryDto,
  ): Promise<ConformanceDeadlineResponse> {
    const startEpochMs = Date.now();
    const delayMs = query.delayMs ?? 0;
    try {
      await waitForDelayOrAbort(delayMs, getRequestSignal());
    } finally {
      throwIfAborted();
    }
    return {
      completedAfterMs: Math.max(0, Date.now() - startEpochMs),
      remainingBudgetMs: remainingMs() ?? null,
    };
  }
}
