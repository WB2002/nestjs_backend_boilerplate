import { Pool } from 'pg';

describe('pg module (integration Jest config)', () => {
  it('constructs Pool', async () => {
    const pool = new Pool({
      connectionString: 'postgres://localhost:5432/postgres',
    });
    expect(typeof pool.query).toBe('function');
    await pool.end();
  });
});
