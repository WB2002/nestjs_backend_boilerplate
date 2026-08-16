import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
import { SkipSanitization } from '@/common/sanitization';

export class LoginDto {
  @IsEmail()
  declare email: string;

  @IsNotEmpty()
  @SkipSanitization()
  declare password: string;
}

export class RegisterDto {
  @IsEmail()
  declare email: string;

  @IsNotEmpty()
  @MinLength(8)
  @SkipSanitization()
  declare password: string;
}
