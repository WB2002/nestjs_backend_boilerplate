import { Module } from '@nestjs/common';
import { HttpClientModule } from '@/core/http-client';
import { ConformanceCacheController } from './conformance-cache.controller';
import { ConformanceCacheService } from './conformance-cache.service';
import { ConformanceHttpClientController } from './conformance-http-client.controller';
import { ConformanceHttpClientService } from './conformance-http-client.service';

@Module({
  imports: [HttpClientModule],
  controllers: [ConformanceCacheController, ConformanceHttpClientController],
  providers: [ConformanceCacheService, ConformanceHttpClientService],
  exports: [ConformanceCacheService, ConformanceHttpClientService],
})
export class ConformanceModule {}
