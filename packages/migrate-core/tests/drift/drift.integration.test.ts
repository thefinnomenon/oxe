import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connectPostgres,
  detectDatabaseDrift,
  introspectDatabaseSnapshot,
} from '../../src/index.js';
import { createTestSchemaName, getTestDatabaseUrl } from '../helpers.js';

const databaseUrl = getTestDatabaseUrl();
const maybeDescribe = databaseUrl ? describe : describe.skip;

maybeDescribe('introspection + drift (integration)', () => {
  const schema = createTestSchemaName('oxe_drift');
  const tableName = 'drift_items';

  beforeAll(async () => {
    const client = await connectPostgres({ connectionString: databaseUrl });
    try {
      await client.query(`CREATE SCHEMA "${schema}";`);
      await client.query(`CREATE TYPE "${schema}"."status_enum" AS ENUM ('draft', 'published');`);
      await client.query(
        `CREATE TABLE "${schema}"."${tableName}" (
          "id" uuid PRIMARY KEY,
          "org_id" uuid NOT NULL,
          "user_id" uuid NOT NULL,
          "status" "${schema}"."status_enum" NOT NULL DEFAULT 'draft'
        );`,
      );
      await client.query(
        `ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${tableName}_org_user_key" UNIQUE ("org_id", "user_id");`,
      );
      await client.query(
        `CREATE INDEX "${tableName}_org_status_idx" ON "${schema}"."${tableName}" ("org_id", "status");`,
      );
    } finally {
      await client.end();
    }
  });

  afterAll(async () => {
    const client = await connectPostgres({ connectionString: databaseUrl });
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
    } finally {
      await client.end();
    }
  });

  it('detects no drift when expected matches actual', async () => {
    const expected = await introspectDatabaseSnapshot({
      connectionString: databaseUrl,
      schema,
    });
    const actual = await introspectDatabaseSnapshot({
      connectionString: databaseUrl,
      schema,
    });
    const drift = detectDatabaseDrift(expected, actual);

    expect(drift.hasDrift).toBe(false);
    expect(drift.diff.hasChanges).toBe(false);
  });

  it('detects drift after manual column/index changes', async () => {
    const expected = await introspectDatabaseSnapshot({
      connectionString: databaseUrl,
      schema,
    });

    const client = await connectPostgres({ connectionString: databaseUrl });
    try {
      await client.query(
        `ALTER TABLE "${schema}"."${tableName}" ADD COLUMN "manual_extra" text NULL;`,
      );
      await client.query(`DROP INDEX "${schema}"."${tableName}_org_status_idx";`);
    } finally {
      await client.end();
    }

    const actual = await introspectDatabaseSnapshot({
      connectionString: databaseUrl,
      schema,
    });
    const drift = detectDatabaseDrift(expected, actual);

    expect(drift.hasDrift).toBe(true);
    expect(drift.summary.extraColumns).toContain(`${tableName}.manual_extra`);
    expect(
      drift.diff.changes.indexesAdded.some(
        (change) =>
          change.tableName === tableName && change.indexName === `${tableName}_org_status_idx`,
      ),
    ).toBe(true);
  });
});
