import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { BACKGROUND_JOBS_LEASE_EXPIRED_MESSAGE } from '../../constants/background-jobs.constants';
import { BackgroundJobStatus } from '../../types/background-job.types';
import { PostgresJobRepository } from './postgres-job.repository';

const describeIntegration =
  process.env.SKIP_TESTCONTAINERS === 'true' ? describe.skip : describe;

describeIntegration('PostgresJobRepository integration', () => {
  let container: StartedPostgreSqlContainer;
  let poolA: Pool;
  let poolB: Pool;
  let repoA: PostgresJobRepository;
  let repoB: PostgresJobRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const uri = container.getConnectionUri();
    poolA = new Pool({ connectionString: uri });
    poolB = new Pool({ connectionString: uri });
    const migration = readFileSync(
      join(
        process.cwd(),
        'migrations/postgres/002_create_background_jobs.sql',
      ),
      'utf8',
    );
    await poolA.query(migration);
    repoA = new PostgresJobRepository(poolA);
    repoB = new PostgresJobRepository(poolB);
  }, 120_000);

  afterAll(async () => {
    await poolA?.end();
    await poolB?.end();
    await container?.stop();
  });

  it('allows only one VM to claim the same job row', async () => {
    const inserted = await repoA.insertPending({
      queueName: 'default',
      jobName: 'echo',
      payload: { message: 'test' },
      runAt: new Date(),
      maxAttempts: 5,
    });
    expect(inserted).not.toBeNull();
    const id = inserted!.id;

    const [a, b] = await Promise.all([
      repoA.claimById({ id, workerId: 'vm-a:1', leaseSec: 300 }),
      repoB.claimById({ id, workerId: 'vm-b:2', leaseSec: 300 }),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
  });

  it('dedupes active jobs by dedupe_key', async () => {
    const first = await repoA.insertPending({
      queueName: 'default',
      jobName: 'echo',
      dedupeKey: 'dedupe-1',
      payload: {},
      runAt: new Date(),
      maxAttempts: 5,
    });
    const second = await repoA.insertPending({
      queueName: 'default',
      jobName: 'echo',
      dedupeKey: 'dedupe-1',
      payload: {},
      runAt: new Date(),
      maxAttempts: 5,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('reclaims expired processing lease to pending', async () => {
    const inserted = await repoA.insertPending({
      queueName: 'default',
      jobName: 'echo',
      payload: {},
      runAt: new Date(),
      maxAttempts: 5,
    });
    expect(inserted).not.toBeNull();
    const id = inserted!.id;

    const claimed = await repoA.claimById({
      id,
      workerId: 'vm-a:1',
      leaseSec: 300,
    });
    expect(claimed).not.toBeNull();

    await poolA.query(
      `UPDATE background_jobs SET lease_until = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [id],
    );

    const reclaimed = await repoB.reclaimExpiredLeases(10);
    expect(reclaimed).toEqual([
      expect.objectContaining({
        id,
        status: BackgroundJobStatus.Pending,
        maxAttempts: 5,
      }),
    ]);

    const status = await repoA.getStatus(id);
    expect(status).toBe(BackgroundJobStatus.Pending);

    const secondClaim = await repoA.claimById({
      id,
      workerId: 'vm-a:2',
      leaseSec: 300,
    });
    expect(secondClaim).not.toBeNull();
    expect(secondClaim!.attempts).toBe(2);
  });

  it('marks terminal failed when attempts already at max_attempts', async () => {
    const inserted = await repoA.insertPending({
      queueName: 'default',
      jobName: 'echo',
      payload: {},
      runAt: new Date(),
      maxAttempts: 1,
    });
    const id = inserted!.id;
    await repoA.claimById({ id, workerId: 'vm-a:1', leaseSec: 300 });
    await poolA.query(
      `UPDATE background_jobs SET lease_until = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [id],
    );

    const reclaimed = await repoA.reclaimExpiredLeases(10);
    expect(reclaimed[0]?.status).toBe(BackgroundJobStatus.Failed);

    const { rows } = await poolA.query<{ last_error: string }>(
      `SELECT last_error FROM background_jobs WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.last_error).toBe(BACKGROUND_JOBS_LEASE_EXPIRED_MESSAGE);
  });
});
