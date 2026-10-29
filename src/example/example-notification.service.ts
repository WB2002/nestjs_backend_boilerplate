import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_SERVICE,
  type INotificationService,
} from '@/core/notification';
import type { CreateExampleNotificationDto } from './dto';

export interface ExampleNotificationResult {
  status: 'success';
  operationId: string;
  notificationSent: boolean;
}

@Injectable()
export class ExampleNotificationService {
  private readonly logger = new Logger(ExampleNotificationService.name);

  constructor(
    @Inject(NOTIFICATION_SERVICE)
    private readonly notificationService: INotificationService,
  ) {}

  /**
   * Demonstrates a business operation that notifies via INotificationService.
   * Notification failures are logged and do not fail the operation.
   */
  async runExampleOperation(
    dto: CreateExampleNotificationDto,
  ): Promise<ExampleNotificationResult> {
    const operationId =
      typeof dto.metadata?.operationId === 'string' &&
      dto.metadata.operationId.trim() !== ''
        ? dto.metadata.operationId
        : `example-${Date.now()}`;

    // Example business operation (no side effects beyond notification).
    const operationResult = {
      operationId,
      completedAt: new Date().toISOString(),
    };

    let isNotificationSent = false;
    try {
      await this.notificationService.send({
        title: 'Operation Completed',
        message: dto.message,
        metadata: {
          ...dto.metadata,
          operationId,
          operationStatus: 'success',
        },
      });
      isNotificationSent = true;
    } catch (error) {
      this.logger.error({
        message: 'notification failed after successful operation',
        operationId,
        errorName: error instanceof Error ? error.name : 'unknown',
        errorCode:
          error instanceof Error && 'code' in error
            ? (error as { code?: string }).code
            : undefined,
      });
    }

    return {
      status: 'success',
      operationId: operationResult.operationId,
      notificationSent: isNotificationSent,
    };
  }
}
