import { Module } from '@nestjs/common';
import { CaptchaModule } from '@/core/captcha';
import { ExampleCaptchaController } from './example-captcha.controller';

@Module({
  imports: [CaptchaModule],
  controllers: [ExampleCaptchaController],
})
export class ExampleModule {}
