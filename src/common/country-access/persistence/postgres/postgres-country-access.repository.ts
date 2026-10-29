import { Inject, Injectable } from '@nestjs/common';
import type { Pool, QueryResultRow } from 'pg';
import { POSTGRES_POOL } from '../../constants';
import {
  assertCountryCode,
  CountryAccessConflictError,
  type CountryAccessConfig,
  type CountryAccessRepository,
} from '../../domain';

interface CountryAccessRow extends QueryResultRow {
  country_code: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class PostgresCountryAccessRepository implements CountryAccessRepository {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async getAll(): Promise<CountryAccessConfig[]> {
    const result = await this.pool.query<CountryAccessRow>(
      `SELECT country_code, enabled, created_at, updated_at
       FROM country_access
       ORDER BY country_code ASC`,
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async getByCountryCode(
    countryCode: string,
  ): Promise<CountryAccessConfig | null> {
    const code = assertCountryCode(countryCode);
    const result = await this.pool.query<CountryAccessRow>(
      `SELECT country_code, enabled, created_at, updated_at
       FROM country_access
       WHERE country_code = $1`,
      [code],
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : null;
  }

  /**
   * Inserts a new row, or updates an existing one when `config.updatedAt`
   * matches the currently stored `updated_at` (optimistic concurrency).
   */
  async upsert(config: CountryAccessConfig): Promise<CountryAccessConfig> {
    const code = assertCountryCode(config.countryCode);
    const existing = await this.getByCountryCode(code);

    if (!existing) {
      const inserted = await this.pool.query<CountryAccessRow>(
        `INSERT INTO country_access (country_code, enabled, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3, NOW()), COALESCE($4, NOW()))
         ON CONFLICT (country_code) DO NOTHING
         RETURNING country_code, enabled, created_at, updated_at`,
        [code, config.enabled, config.createdAt, config.updatedAt],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new CountryAccessConflictError(
          `Country access ${code} was created concurrently`,
        );
      }
      return this.mapRow(row);
    }

    const nextUpdatedAt = new Date();
    const updated = await this.pool.query<CountryAccessRow>(
      `UPDATE country_access
       SET enabled = $2,
           updated_at = $3
       WHERE country_code = $1
         AND updated_at = $4
       RETURNING country_code, enabled, created_at, updated_at`,
      [code, config.enabled, nextUpdatedAt, config.updatedAt],
    );
    const row = updated.rows[0];
    if (!row) {
      throw new CountryAccessConflictError(
        `Country access ${code} was modified concurrently`,
      );
    }
    return this.mapRow(row);
  }

  async delete(countryCode: string): Promise<void> {
    const code = assertCountryCode(countryCode);
    await this.pool.query(
      `DELETE FROM country_access WHERE country_code = $1`,
      [code],
    );
  }

  private mapRow(row: CountryAccessRow): CountryAccessConfig {
    return {
      countryCode: assertCountryCode(row.country_code.trim()),
      enabled: row.enabled,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
