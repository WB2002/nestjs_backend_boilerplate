import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole } from '../constants';

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

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.USER,
  })
  declare role: UserRole;
}

export const UserSchema = SchemaFactory.createForClass(User);
