import { Module } from '@nestjs/common';
import { ExampleNotificationController } from './example-notification.controller';
import { ExampleNotificationService } from './example-notification.service';

@Module({
  controllers: [ExampleNotificationController],
  providers: [ExampleNotificationService],
})
export class ExampleModule {}
