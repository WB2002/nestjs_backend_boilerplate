import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  declare email: string;

  @Prop({ required: true })
  declare passwordHash: string;

  @Prop({ default: true })
  declare isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
