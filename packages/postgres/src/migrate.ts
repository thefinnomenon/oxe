import { createHash } from 'node:crypto';

import type { ApplicationPostgresMigrationV1 } from '@oxe/compiler';

import type { ApplicationSqlConnectionV1, ApplicationSqlPoolV1 } from './types.js';

export type ApplicationPostgresMigrationErrorCode = 'OXE2501' | 'OXE2502' | 'OXE2503';

export class ApplicationPostgresMigrationError extends Error {
  public constructor(
    public readonly code: ApplicationPostgresMigrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationPostgresMigrationError';
  }
}

export interface ApplicationPostgresMigrationResultV1 {
  readonly applied: boolean;
  readonly checksum: string;
  readonly fromRevision: number;
  readonly migrationId: string;
  readonly toRevision: number;
}

export interface ApplicationPostgresMigrationApplyOptionsV1 {
  /** Explicit checksums for previously applied, semantically equivalent forms of this migration. */
  readonly acceptedChecksums?: readonly string[];
}

interface MigrationRow extends Record<string, unknown> {
  readonly checksum: string;
  readonly from_revision: number;
  readonly migration_id: string;
  readonly to_revision: number;
}

const migrationChecksum = (migration: ApplicationPostgresMigrationV1): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        appId: migration.appId,
        fromRevision: migration.fromRevision,
        migrationId: migration.migrationId,
        sql: migration.sql,
        toRevision: migration.toRevision,
      }),
    )
    .digest('hex');

const ensureLedger = async (connection: ApplicationSqlConnectionV1): Promise<void> => {
  await connection.query(`CREATE TABLE IF NOT EXISTS public._oxe_migrations (
  app_id TEXT NOT NULL,
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  migration_id TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_oxe_migrations PRIMARY KEY (app_id, to_revision),
  CONSTRAINT uq_oxe_migrations_id UNIQUE (app_id, migration_id),
  CONSTRAINT ck_oxe_migrations_forward CHECK (to_revision > from_revision)
)`);
};

const resultFor = (
  migration: ApplicationPostgresMigrationV1,
  checksum: string,
  applied: boolean,
): ApplicationPostgresMigrationResultV1 => ({
  applied,
  checksum,
  fromRevision: migration.fromRevision,
  migrationId: migration.migrationId,
  toRevision: migration.toRevision,
});

/** Applies one compiler-owned forward migration with per-application locking and checksums. */
export const applyApplicationPostgresMigration = async (
  pool: ApplicationSqlPoolV1,
  migration: ApplicationPostgresMigrationV1,
  options: ApplicationPostgresMigrationApplyOptionsV1 = {},
): Promise<ApplicationPostgresMigrationResultV1> => {
  if (migration.toRevision <= migration.fromRevision)
    throw new ApplicationPostgresMigrationError(
      'OXE2501',
      `Migration ${migration.migrationId} must advance its graph revision.`,
    );
  const checksum = migrationChecksum(migration);
  const acceptedChecksums = new Set(options.acceptedChecksums ?? []);
  for (const acceptedChecksum of acceptedChecksums)
    if (!/^[a-f\d]{64}$/u.test(acceptedChecksum))
      throw new TypeError('Accepted migration checksums must be lowercase SHA-256 values.');
  return pool.transaction(async (connection) => {
    await ensureLedger(connection);
    await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      migration.appId,
    ]);
    const existing = await connection.query<MigrationRow>(
      `SELECT from_revision, to_revision, migration_id, checksum
FROM public._oxe_migrations
WHERE app_id = $1 AND (to_revision = $2 OR migration_id = $3)
ORDER BY to_revision DESC`,
      [migration.appId, migration.toRevision, migration.migrationId],
    );
    const duplicate = existing.rows[0];
    if (duplicate) {
      if (
        duplicate.to_revision !== migration.toRevision ||
        duplicate.from_revision !== migration.fromRevision ||
        duplicate.migration_id !== migration.migrationId ||
        (duplicate.checksum !== checksum && !acceptedChecksums.has(duplicate.checksum))
      )
        throw new ApplicationPostgresMigrationError(
          'OXE2502',
          `Migration ${migration.migrationId} conflicts with immutable applied history.`,
        );
      return resultFor(migration, duplicate.checksum, false);
    }
    const head = await connection.query<MigrationRow>(
      `SELECT from_revision, to_revision, migration_id, checksum
FROM public._oxe_migrations
WHERE app_id = $1
ORDER BY to_revision DESC
LIMIT 1`,
      [migration.appId],
    );
    const currentRevision = head.rows[0]?.to_revision ?? 0;
    if (currentRevision !== migration.fromRevision)
      throw new ApplicationPostgresMigrationError(
        'OXE2503',
        `Migration ${migration.migrationId} expects r${migration.fromRevision}, but database head is r${currentRevision}.`,
      );
    await connection.query(migration.sql);
    await connection.query(
      `INSERT INTO public._oxe_migrations
  (app_id, from_revision, to_revision, migration_id, checksum)
VALUES ($1, $2, $3, $4, $5)`,
      [
        migration.appId,
        migration.fromRevision,
        migration.toRevision,
        migration.migrationId,
        checksum,
      ],
    );
    return resultFor(migration, checksum, true);
  });
};
