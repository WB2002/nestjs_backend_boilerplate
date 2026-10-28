import { BackgroundJobStatus } from '../enums/background-job-status.enum';

export type BackgroundJobRow = {
  id: string;
  queueName: string;
  jobName: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
};

export type InsertPendingJobInput = {
  queueName: string;
  jobName: string;
  dedupeKey?: string;
  payload: unknown;
  runAt: Date;
  maxAttempts: number;
};

export type ClaimJobInput = {
  id: string;
  workerId: string;
  leaseSec: number;
};

export { BackgroundJobStatus };
