import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FeatureFlagAudit, FeatureFlagAuditAction } from './schemas';

@Injectable()
export class FeatureFlagAuditService {
  constructor(
    @InjectModel(FeatureFlagAudit.name)
    private readonly auditModel: Model<FeatureFlagAudit>,
  ) {}

  async record(params: {
    key: string;
    environment: string;
    action: FeatureFlagAuditAction;
    actorUserId: string;
    actorEmail: string;
    oldValue: Record<string, unknown> | null;
    newValue: Record<string, unknown> | null;
    version: number;
  }): Promise<void> {
    await this.auditModel.create({
      key: params.key,
      environment: params.environment,
      action: params.action,
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      oldValue: params.oldValue,
      newValue: params.newValue,
      version: params.version,
    });
  }
}
