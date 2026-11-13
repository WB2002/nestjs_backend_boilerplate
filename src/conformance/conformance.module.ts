import { Module } from '@nestjs/common';
import { ConformanceCacheController } from './conformance-cache.controller';
import { ConformanceCacheService } from './conformance-cache.service';

@Module({
  controllers: [ConformanceCacheController],
  providers: [ConformanceCacheService],
  exports: [ConformanceCacheService],
})
export class ConformanceModule {}
