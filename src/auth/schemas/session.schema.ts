import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from './user.schema';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Session extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: string | User;

  @Prop({ required: true, unique: true })
  token: string;

  @Prop()
  userAgent: string;

  @Prop()
  ip: string;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
