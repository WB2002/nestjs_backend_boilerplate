import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CreateExampleNotificationDto } from './dto';
import { ExampleNotificationService } from './example-notification.service';

/**
 * Example endpoint demonstrating NotificationService usage.
 * Request body validated with class-validator (global ValidationPipe).
 */
@UseGuards(JwtAuthGuard)
@Controller('example')
export class ExampleNotificationController {
  constructor(
    private readonly exampleNotificationService: ExampleNotificationService,
  ) {}

  @Post('notification')
  async notify(@Body() body: CreateExampleNotificationDto): Promise<{
    status: 'success';
    operationId: string;
    notificationSent: boolean;
  }> {
    return this.exampleNotificationService.runExampleOperation(body);
  }
}
