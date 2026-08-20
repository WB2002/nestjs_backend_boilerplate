import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({
  collection: 'country_access',
  timestamps: true,
  versionKey: false,
})
export class CountryAccessDocument {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({
    required: true,
    uppercase: true,
    trim: true,
    minlength: 2,
    maxlength: 2,
  })
  countryCode!: string;

  @Prop({ required: true })
  enabled!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const CountryAccessSchema = SchemaFactory.createForClass(
  CountryAccessDocument,
);

CountryAccessSchema.index({ countryCode: 1 }, { unique: true });
