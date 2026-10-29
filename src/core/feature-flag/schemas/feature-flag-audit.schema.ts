import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export const FeatureFlagAuditAction = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;

export type FeatureFlagAuditAction =
  (typeof FeatureFlagAuditAction)[keyof typeof FeatureFlagAuditAction];

@Schema({ timestamps: true, collection: 'feature_flag_audits' })
export class FeatureFlagAudit extends Document {
  @Prop({ required: true })
  declare key: string;

  @Prop({ required: true })
  declare environment: string;

  @Prop({ required: true, enum: Object.values(FeatureFlagAuditAction) })
  declare action: FeatureFlagAuditAction;

  @Prop({ required: true })
  declare actorUserId: string;

  @Prop({ required: true })
  declare actorEmail: string;

  @Prop({ type: Object, default: null })
  declare oldValue: Record<string, unknown> | null;

  @Prop({ type: Object, default: null })
  declare newValue: Record<string, unknown> | null;

  @Prop({ required: true })
  declare version: number;
}

export const FeatureFlagAuditSchema =
  SchemaFactory.createForClass(FeatureFlagAudit);
