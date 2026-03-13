import type { Client, PoolClient } from 'pg';

import { quoteIdentifier } from '../sql/helpers.js';
import { OXE_MIGRATIONS_TABLE } from './constants.js';
import type { AppliedMigrationRecord } from './types.js';

export const listAppliedMigrations = async (
  client: Client | PoolClient,
): Promise<AppliedMigrationRecord[]> => {
  const result = await client.query<{
    id: string;
    checksum: string;
    applied_at: string | Date;
    execution_ms: number;
  }>(
    `SELECT id, checksum, applied_at, execution_ms
     FROM ${quoteIdentifier(OXE_MIGRATIONS_TABLE)}
     ORDER BY id ASC;`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    checksum: row.checksum,
    appliedAt: typeof row.applied_at === 'string' ? row.applied_at : row.applied_at.toISOString(),
    executionMs: row.execution_ms,
  }));
};
