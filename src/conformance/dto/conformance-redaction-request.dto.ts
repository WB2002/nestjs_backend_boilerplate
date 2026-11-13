import { IsObject } from 'class-validator';

export class ConformanceRedactionRequestDto {
  @IsObject()
  declare payload: Record<string, unknown>;
}
