import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SkipSqlInjectionCheck } from '@/common/sanitization';

/**
 * GraphQL input DTO — demonstrates global SanitizationPipe + field decorators
 * on resolver args (schema-first + class metatype).
 *
 * websiteUrl is not @SafeUrl here: this query is @Public() and unused for
 * outbound fetch. Use @SafeUrl() on authenticated fields that are actually fetched.
 */
export class CategoryFilterInput {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  @SkipSqlInjectionCheck()
  declare name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  declare websiteUrl?: string;
}
