import type { Job } from 'bullmq';
import { BackgroundJobsRunProcessor } from './background-jobs-run.processor';
import type { PostgresJobRepository } from '../persistence/postgres/postgres-job.repository';
import type { JobHandlerRegistry } from '../handlers/job-handler.registry';
import type { BackgroundJobsConfig } from '@/common/config/parse-background-jobs-config';
import { BackgroundJobStatus } from '../types/background-job.types';

describe('BackgroundJobsRunProcessor', () => {
  const config = { claimLeaseSec: 300 } as BackgroundJobsConfig;

  it('skips handler when claim returns null and job completed', async () => {
    const repo = {
      claimById: jest.fn().mockResolvedValue(null),
      getStatus: jest.fn().mockResolvedValue(BackgroundJobStatus.Completed),
      markCompleted: jest.fn(),
    } as unknown as PostgresJobRepository;
    const handler = { handle: jest.fn() };
    const registry = {
      get: jest.fn().mockReturnValue(handler),
    } as unknown as JobHandlerRegistry;

    const processor = new BackgroundJobsRunProcessor(repo, registry, config);
    await processor.process({
      data: { jobRowId: 'id-1' },
    } as Job<{ jobRowId: string }>);

    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('runs handler once when claim succeeds', async () => {
    const repo = {
      claimById: jest.fn().mockResolvedValue({
        id: 'id-1',
        jobName: 'example.echo',
        payload: { message: 'x' },
        attempts: 1,
        maxAttempts: 5,
        queueName: 'default',
      }),
      markCompleted: jest.fn(),
    } as unknown as PostgresJobRepository;
    const handler = { handle: jest.fn().mockResolvedValue(undefined) };
    const registry = {
      get: jest.fn().mockReturnValue(handler),
    } as unknown as JobHandlerRegistry;

    const processor = new BackgroundJobsRunProcessor(repo, registry, config);
    await processor.process({
      data: { jobRowId: 'id-1' },
    } as Job<{ jobRowId: string }>);

    expect(handler.handle).toHaveBeenCalledWith({ message: 'x' });
    expect(repo.markCompleted).toHaveBeenCalledWith('id-1');
  });
});
