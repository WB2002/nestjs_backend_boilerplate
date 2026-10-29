import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { ConfigModule } from '@nestjs/config';
import { FeatureFlagModule } from '@/core/feature-flag';

@Module({
  imports: [TerminusModule, ConfigModule, FeatureFlagModule],
  controllers: [HealthController],
})
export class HealthModule {}
