import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FeatureFlagTargetingAttribute, FeatureFlagType } from '../types';

export class FeatureFlagTargetingDto {
  @IsIn([
    FeatureFlagTargetingAttribute.USER_ID,
    FeatureFlagTargetingAttribute.ORGANIZATION_ID,
  ])
  attribute!: FeatureFlagTargetingAttribute;
}

export class CreateFeatureFlagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  key!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsIn([FeatureFlagType.BOOLEAN, FeatureFlagType.PERCENTAGE])
  type!: typeof FeatureFlagType.BOOLEAN | typeof FeatureFlagType.PERCENTAGE;

  @ValidateIf(
    (dto: CreateFeatureFlagDto) => dto.type === FeatureFlagType.PERCENTAGE,
  )
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @ValidateIf(
    (dto: CreateFeatureFlagDto) => dto.type === FeatureFlagType.PERCENTAGE,
  )
  @ValidateNested()
  @Type(() => FeatureFlagTargetingDto)
  targeting?: FeatureFlagTargetingDto;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  owner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  expiresAt?: string;
}

export class UpdateFeatureFlagDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsBoolean()
  enabled!: boolean;

  @IsIn([FeatureFlagType.BOOLEAN, FeatureFlagType.PERCENTAGE])
  type!: typeof FeatureFlagType.BOOLEAN | typeof FeatureFlagType.PERCENTAGE;

  @ValidateIf(
    (dto: UpdateFeatureFlagDto) => dto.type === FeatureFlagType.PERCENTAGE,
  )
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @ValidateIf(
    (dto: UpdateFeatureFlagDto) => dto.type === FeatureFlagType.PERCENTAGE,
  )
  @ValidateNested()
  @Type(() => FeatureFlagTargetingDto)
  targeting?: FeatureFlagTargetingDto;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  owner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  expiresAt?: string;
}

export class DeleteFeatureFlagDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
