import { Module } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { HCaptchaService } from './hcaptcha.service';

@Module({
  providers: [
    {
      provide: CaptchaService,
      useClass: HCaptchaService,
    },
  ],
  exports: [CaptchaService],
})
export class CaptchaModule {}
