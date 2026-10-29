import { Logger } from '@nestjs/common';
import {
  NotificationError,
  NotificationErrorCode,
  type INotificationService,
} from '@/core/notification';
import { ExampleNotificationService } from '../example-notification.service';

describe('ExampleNotificationService', () => {
  let notificationService: { send: jest.Mock };
  let service: ExampleNotificationService;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    notificationService = { send: jest.fn() };
    service = new ExampleNotificationService(
      notificationService as unknown as INotificationService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns success when the request is valid and notification succeeds', async () => {
    notificationService.send.mockResolvedValue(undefined);

    const runResult = await service.runExampleOperation({
      message: 'Example operation completed successfully',
      metadata: { operationId: '123', operationStatus: 'success' },
    });

    expect(runResult).toEqual({
      status: 'success',
      operationId: '123',
      notificationSent: true,
    });
    expect(notificationService.send).toHaveBeenCalledWith({
      title: 'Operation Completed',
      message: 'Example operation completed successfully',
      metadata: expect.objectContaining({
        operationId: '123',
        operationStatus: 'success',
      }),
    });
  });

  it('keeps the business outcome successful when notification fails', async () => {
    notificationService.send.mockRejectedValue(
      new NotificationError('Slack webhook is unavailable', {
        code: NotificationErrorCode.UNAVAILABLE,
      }),
    );

    const runResult = await service.runExampleOperation({
      message: 'Example operation completed successfully',
      metadata: { operationId: '123' },
    });

    expect(runResult.status).toBe('success');
    expect(runResult.operationId).toBe('123');
    expect(runResult.notificationSent).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('generates an operationId when metadata omits one', async () => {
    notificationService.send.mockResolvedValue(undefined);

    const runResult = await service.runExampleOperation({
      message: 'done',
    });

    expect(runResult.status).toBe('success');
    expect(runResult.notificationSent).toBe(true);
    expect(runResult.operationId).toMatch(/^example-/);
  });
});
