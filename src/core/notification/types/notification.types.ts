export interface INotification {
  title?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface INotificationService {
  send(notification: INotification): Promise<void>;
}
