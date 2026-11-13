import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ConformanceHttpClientRequestDto {
  @IsIn(['internal', 'external'])
  declare clientKind: 'internal' | 'external';

  @IsString()
  @Matches(/^[a-z0-9-]{1,64}$/)
  declare clientName: string;

  @IsString()
  declare targetUrl: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  declare maxRetries?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2000)
  declare baseDelayMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  declare circuitBreakerFailureThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(60_000)
  declare circuitBreakerResetTimeoutMs?: number;

  @IsOptional()
  @IsBoolean()
  declare shouldCoalesce?: boolean;

  @IsOptional()
  @IsIn(['fixed', 'adaptive'])
  declare concurrencyMode?: 'fixed' | 'adaptive';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  declare maxConcurrent?: number;

  @IsOptional()
  @IsBoolean()
  declare shouldPropagateDeadline?: boolean;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(30_000)
  declare timeoutMs?: number;
}
