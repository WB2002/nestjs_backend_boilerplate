import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from './user.schema';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Session extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  declare userId: string | User;

  @Prop({ required: true, unique: true })
  declare token: string;

  @Prop()
  declare userAgent: string;

  @Prop()
  declare ip: string;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  declare expiresAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
