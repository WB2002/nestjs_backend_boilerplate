export enum BackgroundJobStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export function parseBackgroundJobStatus(
  raw: string,
): BackgroundJobStatus | undefined {
  const values = Object.values(BackgroundJobStatus) as string[];
  if (values.includes(raw)) {
    return raw as BackgroundJobStatus;
  }
  return undefined;
}
