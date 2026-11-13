import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ConformanceCacheRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare key: string;

  @IsOptional()
  @ValidateIf(
    (_target: unknown, propertyValue: unknown) => propertyValue !== null,
  )
  @IsString()
  declare value?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  declare loaderDelayMs?: number;

  @IsOptional()
  @IsBoolean()
  declare shouldFailLoader?: boolean;

  @IsInt()
  @Min(1)
  @Max(600_000)
  declare softTtlMs: number;

  @IsInt()
  @Min(1)
  @Max(600_000)
  declare hardTtlMs: number;

  @IsOptional()
  @IsBoolean()
  declare shouldCacheNull?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600_000)
  declare negativeSoftTtlMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600_000)
  declare negativeHardTtlMs?: number;
}
