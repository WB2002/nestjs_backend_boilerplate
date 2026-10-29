import { JobEnqueueService } from '../job-enqueue.service';
import type { PostgresJobRepository } from '../persistence/postgres/postgres-job.repository';
import type { Queue } from 'bullmq';
import type { BackgroundJobsConfig } from '@/common/config/parse-background-jobs-config';
import { BACKGROUND_JOBS_RUN_JOB_NAME } from '../constants/background-jobs.constants';

describe('JobEnqueueService', () => {
  it('adds BullMQ job after postgres insert', async () => {
    const repo = {
      insertPending: jest.fn().mockResolvedValue({ id: 'job-1' }),
    } as unknown as PostgresJobRepository;
    const queue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const config = {
      defaultQueueName: 'default',
    } as BackgroundJobsConfig;

    const service = new JobEnqueueService(repo, queue, config);
    const result = await service.enqueue({
      jobName: 'example.echo',
      payload: { message: 'hi' },
    });

    expect(result.enqueued).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      BACKGROUND_JOBS_RUN_JOB_NAME,
      { jobRowId: 'job-1' },
      expect.objectContaining({ jobId: 'job-1' }),
    );
  });

  it('returns deduplicated when insert conflicts', async () => {
    const repo = {
      insertPending: jest.fn().mockResolvedValue(null),
    } as unknown as PostgresJobRepository;
    const queue = { add: jest.fn() } as unknown as Queue;
    const config = { defaultQueueName: 'default' } as BackgroundJobsConfig;
    const service = new JobEnqueueService(repo, queue, config);
    const result = await service.enqueue({
      jobName: 'example.echo',
      payload: {},
      dedupeKey: 'k',
    });
    expect(result.deduplicated).toBe(true);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('wakeJobRow removes completed redis job and re-adds run job', async () => {
    const repo = {} as PostgresJobRepository;
    const remove = jest.fn().mockResolvedValue(undefined);
    const getState = jest.fn().mockResolvedValue('completed');
    const queue = {
      getJob: jest.fn().mockResolvedValue({ getState, remove }),
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const config = { defaultQueueName: 'default' } as BackgroundJobsConfig;

    const service = new JobEnqueueService(repo, queue, config);
    await service.wakeJobRow('00000000-0000-4000-8000-000000000001', 5);

    expect(remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      BACKGROUND_JOBS_RUN_JOB_NAME,
      { jobRowId: '00000000-0000-4000-8000-000000000001' },
      expect.objectContaining({
        jobId: '00000000-0000-4000-8000-000000000001',
      }),
    );
  });

  it('wakeJobRow skips add when redis job is already waiting', async () => {
    const repo = {} as PostgresJobRepository;
    const queue = {
      getJob: jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('waiting'),
        remove: jest.fn(),
      }),
      add: jest.fn(),
    } as unknown as Queue;
    const config = { defaultQueueName: 'default' } as BackgroundJobsConfig;

    const service = new JobEnqueueService(repo, queue, config);
    await service.wakeJobRow('id-1', 5);

    expect(queue.add).not.toHaveBeenCalled();
  });
});
