import { IsOptional, IsString, MinLength } from 'class-validator';
import { SafeUrl, SkipSqlInjectionCheck } from '@/common/sanitization';

/**
 * GraphQL input DTO — demonstrates global SanitizationPipe + field decorators
 * on resolver args (schema-first + class metatype).
 */
export class CategoryFilterInput {
  @IsString()
  @MinLength(1)
  @SkipSqlInjectionCheck()
  declare name: string;

  @IsOptional()
  @IsString()
  @SafeUrl()
  declare websiteUrl?: string;
}
