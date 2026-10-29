import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from '@/common/redis/redis.module';
import { FeatureFlagAuditService } from './feature-flag.audit.service';
import { FeatureFlagController } from './feature-flag.controller';
import { FeatureFlagHealthIndicator } from './feature-flag.health';
import { FeatureFlagManager } from './feature-flag.manager';
import { FeatureFlagReconciler } from './feature-flag.reconciler';
import { FeatureFlagRepository } from './feature-flag.repository';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlagSubscriber } from './feature-flag.subscriber';
import { FeatureFlagPermissionsGuard } from './guards';
import { FeatureFlagAudit, FeatureFlagAuditSchema } from './schemas';

@Module({
  imports: [
    RedisModule,
    MongooseModule.forFeature([
      { name: FeatureFlagAudit.name, schema: FeatureFlagAuditSchema },
    ]),
  ],
  controllers: [FeatureFlagController],
  providers: [
    FeatureFlagRepository,
    FeatureFlagService,
    FeatureFlagManager,
    FeatureFlagAuditService,
    FeatureFlagSubscriber,
    FeatureFlagReconciler,
    FeatureFlagHealthIndicator,
    FeatureFlagPermissionsGuard,
  ],
  exports: [FeatureFlagService, FeatureFlagHealthIndicator],
})
export class FeatureFlagModule {}
