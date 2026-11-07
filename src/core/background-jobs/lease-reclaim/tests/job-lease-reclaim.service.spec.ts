import type { BackgroundJobsConfig } from '@/common/config/parse-background-jobs-config';
import { JobEnqueueService } from '../../job-enqueue.service';
import type { PostgresJobRepository } from '../../persistence/postgres/postgres-job.repository';
import { BackgroundJobStatus } from '../../types/background-job.types';
import { JobLeaseReclaimService } from '../job-lease-reclaim.service';

describe('JobLeaseReclaimService', () => {
  const baseConfig = {
    enabled: true,
    leaseReclaimEnabled: true,
    leaseReclaimBatchSize: 25,
    leaseReclaimIntervalMs: 30_000,
    orphanMinAgeSec: 30,
  } as BackgroundJobsConfig;

  it('wakes pending rows after reclaim', async () => {
    const repo = {
      reclaimExpiredLeases: jest.fn().mockResolvedValue([
        {
          id: 'job-1',
          status: BackgroundJobStatus.Pending,
          maxAttempts: 5,
        },
        {
          id: 'job-2',
          status: BackgroundJobStatus.Failed,
          maxAttempts: 5,
        },
      ]),
      findOrphanedPendingJobs: jest.fn().mockResolvedValue([]),
    } as unknown as PostgresJobRepository;
    const enqueue = {
      wakeJobRow: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobEnqueueService;

    const service = new JobLeaseReclaimService(repo, enqueue, baseConfig);
    await service.tick();

    expect(repo.reclaimExpiredLeases).toHaveBeenCalledWith(25);
    expect(enqueue.wakeJobRow).toHaveBeenCalledTimes(1);
    expect(enqueue.wakeJobRow).toHaveBeenCalledWith('job-1', 5);
  });

  it('wakes orphaned pending rows', async () => {
    const repo = {
      reclaimExpiredLeases: jest.fn().mockResolvedValue([]),
      findOrphanedPendingJobs: jest
        .fn()
        .mockResolvedValue([{ id: 'job-9', maxAttempts: 5 }]),
    } as unknown as PostgresJobRepository;
    const enqueue = {
      wakeJobRow: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobEnqueueService;

    const service = new JobLeaseReclaimService(repo, enqueue, baseConfig);
    await service.tick();

    expect(repo.findOrphanedPendingJobs).toHaveBeenCalledWith(25, 30);
    expect(enqueue.wakeJobRow).toHaveBeenCalledWith('job-9', 5);
  });

  it('one failing wake does not stop the batch during orphan sweep', async () => {
    const repo = {
      reclaimExpiredLeases: jest.fn().mockResolvedValue([]),
      findOrphanedPendingJobs: jest.fn().mockResolvedValue([
        { id: 'job-1', maxAttempts: 3 },
        { id: 'job-2', maxAttempts: 4 },
      ]),
    } as unknown as PostgresJobRepository;
    const enqueue = {
      wakeJobRow: jest
        .fn()
        .mockRejectedValueOnce(new Error('Redis blip'))
        .mockResolvedValueOnce(undefined),
    } as unknown as JobEnqueueService;

    const service = new JobLeaseReclaimService(repo, enqueue, baseConfig);
    await service.tick();

    expect(enqueue.wakeJobRow).toHaveBeenCalledTimes(2);
    expect(enqueue.wakeJobRow).toHaveBeenNthCalledWith(1, 'job-1', 3);
    expect(enqueue.wakeJobRow).toHaveBeenNthCalledWith(2, 'job-2', 4);
  });

  it('does not start timer when reclaim disabled', () => {
    const repo = {
      reclaimExpiredLeases: jest.fn(),
    } as unknown as PostgresJobRepository;
    const enqueue = {
      wakeJobRow: jest.fn(),
    } as unknown as JobEnqueueService;
    const config = {
      ...baseConfig,
      leaseReclaimEnabled: false,
    } as BackgroundJobsConfig;

    const service = new JobLeaseReclaimService(repo, enqueue, config);
    service.onModuleInit();
    expect(service.hasActiveTimer()).toBe(false);
    service.onModuleDestroy();
  });
});
