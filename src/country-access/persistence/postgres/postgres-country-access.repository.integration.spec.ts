import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { PostgresCountryAccessRepository } from './postgres-country-access.repository';
import { CountryAccessConflictError } from '../../domain';

const describeIntegration =
  process.env.SKIP_TESTCONTAINERS === 'true' ? describe.skip : describe;

describeIntegration('PostgresCountryAccessRepository (integration)', () => {
  let pool: Pool;
  let repository: PostgresCountryAccessRepository;
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = new Pool({
      host: container.getHost(),
      port: container.getPort(),
      user: container.getUsername(),
      password: container.getPassword(),
      database: container.getDatabase(),
    });
    const migration = readFileSync(
      join(process.cwd(), 'migrations/postgres/001_create_country_access.sql'),
      'utf8',
    );
    await pool.query(migration);
    repository = new PostgresCountryAccessRepository(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM country_access');
  });

  it('inserts, reads, lists, updates, and deletes', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const created = await repository.upsert({
      countryCode: 'pk',
      enabled: true,
      createdAt,
      updatedAt,
    });
    expect(created.countryCode).toBe('PK');
    expect(created.enabled).toBe(true);

    const byCode = await repository.getByCountryCode('PK');
    expect(byCode).toEqual(created);

    const all = await repository.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.countryCode).toBe('PK');

    const updated = await repository.upsert({
      countryCode: 'PK',
      enabled: false,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
    expect(updated.enabled).toBe(false);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      created.updatedAt.getTime(),
    );

    await repository.delete('PK');
    expect(await repository.getByCountryCode('PK')).toBeNull();
    expect(await repository.getAll()).toEqual([]);
  });

  it('rejects stale updates', async () => {
    const created = await repository.upsert({
      countryCode: 'US',
      enabled: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await repository.upsert({
      countryCode: 'US',
      enabled: false,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
    await expect(
      repository.upsert({
        countryCode: 'US',
        enabled: true,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      }),
    ).rejects.toBeInstanceOf(CountryAccessConflictError);
  });

  it('maps CHAR(2) rows without leaking driver types', async () => {
    await repository.upsert({
      countryCode: 'GB',
      enabled: true,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const row = await repository.getByCountryCode('GB');
    expect(row).toEqual({
      countryCode: 'GB',
      enabled: true,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(Object.keys(row!).sort()).toEqual([
      'countryCode',
      'createdAt',
      'enabled',
      'updatedAt',
    ]);
  });
});
