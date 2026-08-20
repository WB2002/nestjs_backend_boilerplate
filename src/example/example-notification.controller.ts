import { Body, Controller, Post } from '@nestjs/common';
import { CreateExampleNotificationDto } from './dto';
import { ExampleNotificationService } from './example-notification.service';

/**
 * Example endpoint demonstrating NotificationService usage.
 * Remains JWT-protected by the global JwtAuthGuard.
 */
@Controller('example')
export class ExampleNotificationController {
  constructor(
    private readonly exampleNotificationService: ExampleNotificationService,
  ) {}

  @Post('notification')
  async notify(
    @Body() body: CreateExampleNotificationDto,
  ): Promise<{
    status: 'success';
    operationId: string;
    notificationSent: boolean;
  }> {
    return this.exampleNotificationService.runExampleOperation(body);
  }
}
