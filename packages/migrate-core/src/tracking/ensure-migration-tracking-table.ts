import type { Client, PoolClient } from 'pg';

import { quoteIdentifier } from '../sql/helpers.js';
import { OXE_MIGRATIONS_TABLE } from './constants.js';

export const ensureMigrationTrackingTable = async (client: Client | PoolClient): Promise<void> => {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(OXE_MIGRATIONS_TABLE)} (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL
    );`,
  );
};
