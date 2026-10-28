import { PostgresJobRepository } from './postgres-job.repository';
import type { Pool } from 'pg';

describe('PostgresJobRepository', () => {
  it('claimById returns null when no row is claimable', async () => {
    const pool = {
      query: jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    } as unknown as Pool;
    const repo = new PostgresJobRepository(pool);
    const row = await repo.claimById({
      id: '00000000-0000-4000-8000-000000000001',
      workerId: 'vm-a:1',
      leaseSec: 300,
    });
    expect(row).toBeNull();
  });

  it('maps a claimed row', async () => {
    const pool = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            queue_name: 'default',
            job_name: 'echo',
            payload: { message: 'hi' },
            attempts: 1,
            max_attempts: 5,
          },
        ],
      }),
    } as unknown as Pool;
    const repo = new PostgresJobRepository(pool);
    const row = await repo.claimById({
      id: '00000000-0000-4000-8000-000000000001',
      workerId: 'vm-a:1',
      leaseSec: 300,
    });
    expect(row).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      queueName: 'default',
      jobName: 'echo',
      payload: { message: 'hi' },
      attempts: 1,
      maxAttempts: 5,
    });
  });
});
