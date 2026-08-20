import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpClient } from '@/core/http-client';
import { NOTIFICATION_SERVICE } from './notification.constants';
import { SlackNotificationService } from './providers/slack-notification.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: NOTIFICATION_SERVICE,
      inject: [ConfigService, HttpClient],
      useFactory: (configService: ConfigService, httpClient: HttpClient) => {
        return new SlackNotificationService(configService, httpClient);
      },
    },
  ],
  exports: [NOTIFICATION_SERVICE],
})
export class NotificationModule {}
