import { Module } from '@nestjs/common';
import { HttpClientModule } from '@/core/http-client';
import { ConformanceHarnessAuthGuard } from './guards/conformance-harness-auth.guard';
import { ConformanceCacheController } from './conformance-cache.controller';
import { ConformanceCacheService } from './conformance-cache.service';
import { ConformanceDeadlineController } from './conformance-deadline.controller';
import { ConformanceHttpClientController } from './conformance-http-client.controller';
import { ConformanceHttpClientService } from './conformance-http-client.service';
import { ConformancePriorityController } from './conformance-priority.controller';
import { ConformanceRateLimitController } from './conformance-rate-limit.controller';
import { ConformanceRedactionController } from './conformance-redaction.controller';

@Module({
  imports: [HttpClientModule],
  controllers: [
    ConformanceCacheController,
    ConformanceHttpClientController,
    ConformanceDeadlineController,
    ConformancePriorityController,
    ConformanceRateLimitController,
    ConformanceRedactionController,
  ],
  providers: [
    ConformanceCacheService,
    ConformanceHttpClientService,
    ConformanceHarnessAuthGuard,
  ],
  exports: [ConformanceCacheService, ConformanceHttpClientService],
})
export class ConformanceModule {}
