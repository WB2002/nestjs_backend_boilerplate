import { IsNotEmpty, IsString } from 'class-validator';

export class ExampleCaptchaRequestDto {
  @IsString()
  @IsNotEmpty()
  declare captchaToken: string;
}
