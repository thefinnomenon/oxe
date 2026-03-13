import type { Client } from 'pg';

import { OXE_MIGRATIONS_TABLE } from './constants.js';
import type { AppliedMigrationRecord, RecordAppliedMigrationInput } from './types.js';

const quoteIdentifier = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

export const ensureMigrationTrackingTable = async (client: Client): Promise<void> => {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(OXE_MIGRATIONS_TABLE)} (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL
    );`,
  );
};

export const listAppliedMigrations = async (client: Client): Promise<AppliedMigrationRecord[]> => {
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

export const recordAppliedMigration = async (
  client: Client,
  input: RecordAppliedMigrationInput,
): Promise<void> => {
  await client.query(
    `INSERT INTO ${quoteIdentifier(OXE_MIGRATIONS_TABLE)} (id, checksum, execution_ms)
     VALUES ($1, $2, $3);`,
    [input.id, input.checksum, input.executionMs],
  );
};
