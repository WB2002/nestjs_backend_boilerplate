import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
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
});
