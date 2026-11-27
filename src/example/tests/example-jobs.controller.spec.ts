import { ExampleJobsController } from '../example-jobs.controller';
import type { JobEnqueueService } from '@/core/background-jobs';
import { EXAMPLE_ECHO_JOB_NAME } from '../jobs/example-echo.job-handler';

describe('ExampleJobsController', () => {
  it('enqueues echo job', async () => {
    const jobEnqueue = {
      enqueue: jest.fn().mockResolvedValue({
        jobRowId: 'id-1',
        enqueued: true,
        deduplicated: false,
      }),
    } as unknown as JobEnqueueService;
    const controller = new ExampleJobsController(jobEnqueue);
    const outcome = await controller.enqueueEcho({ message: 'hello' });
    expect(jobEnqueue.enqueue).toHaveBeenCalledWith({
      jobName: EXAMPLE_ECHO_JOB_NAME,
      payload: { message: 'hello' },
      dedupeKey: undefined,
    });
    expect(outcome.enqueued).toBe(true);
  });

  it('passes dedupeKey when provided', async () => {
    const jobEnqueue = {
      enqueue: jest.fn().mockResolvedValue({ enqueued: true }),
    } as unknown as JobEnqueueService;
    const controller = new ExampleJobsController(jobEnqueue);

    await controller.enqueueEcho({ message: 'hello', dedupeKey: 'dup-1' });

    expect(jobEnqueue.enqueue).toHaveBeenCalledWith({
      jobName: EXAMPLE_ECHO_JOB_NAME,
      payload: { message: 'hello' },
      dedupeKey: 'dup-1',
    });
  });
});
