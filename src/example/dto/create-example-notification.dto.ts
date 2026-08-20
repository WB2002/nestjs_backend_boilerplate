import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateExampleNotificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  declare message: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
