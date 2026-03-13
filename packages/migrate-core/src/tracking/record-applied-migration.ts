import type { Client, PoolClient } from 'pg';

import { quoteIdentifier } from '../sql/helpers.js';
import { OXE_MIGRATIONS_TABLE } from './constants.js';
import type { RecordAppliedMigrationInput } from './types.js';

export const recordAppliedMigration = async (
  client: Client | PoolClient,
  input: RecordAppliedMigrationInput,
): Promise<void> => {
  await client.query(
    `INSERT INTO ${quoteIdentifier(OXE_MIGRATIONS_TABLE)} (id, checksum, execution_ms)
     VALUES ($1, $2, $3);`,
    [input.id, input.checksum, input.executionMs],
  );
};
