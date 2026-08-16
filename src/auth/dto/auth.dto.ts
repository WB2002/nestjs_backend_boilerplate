import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  declare email: string;

  @IsNotEmpty()
  declare password: string;
}

export class RegisterDto {
  @IsEmail()
  declare email: string;

  @IsNotEmpty()
  @MinLength(8)
  declare password: string;
}
