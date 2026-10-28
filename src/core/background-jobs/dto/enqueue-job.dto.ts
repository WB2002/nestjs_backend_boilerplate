export type EnqueueJobInput = {
  queueName?: string;
  jobName: string;
  payload: unknown;
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
};

export type EnqueueJobResult = {
  jobRowId: string;
  enqueued: boolean;
  deduplicated: boolean;
};
