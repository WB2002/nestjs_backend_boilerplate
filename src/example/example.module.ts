import { Module } from '@nestjs/common';
import { CaptchaModule } from '@/core/captcha';
import { ExampleCaptchaController } from './example-captcha.controller';
import { ExampleNotificationController } from './example-notification.controller';
import { ExampleNotificationService } from './example-notification.service';

@Module({
  imports: [CaptchaModule],
  controllers: [ExampleCaptchaController, ExampleNotificationController],
  providers: [ExampleNotificationService],
})
export class ExampleModule {}
