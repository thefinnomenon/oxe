import type { ApplicationScalarValueV1 } from '@oxe/graph';

import {
  lowerApplicationGraphToDatabaseSchema,
  planApplicationDatabaseMigration,
  type ApplicationDatabaseColumnV1,
  type ApplicationDatabaseMigrationPlanV1,
  type ApplicationDatabaseRelationV1,
  type ApplicationDatabaseSchemaProjectionV1,
} from './application-database.js';
import type { ApplicationGraphV1 } from '@oxe/graph';

export type ApplicationPostgresDiagnosticCode = 'OXE2401' | 'OXE2402';

export interface ApplicationPostgresDiagnostic {
  readonly code: ApplicationPostgresDiagnosticCode;
  readonly message: string;
  readonly path: string;
  readonly semanticId?: string;
}

export class ApplicationPostgresProjectionError extends Error {
  public constructor(public readonly diagnostics: readonly ApplicationPostgresDiagnostic[]) {
    super(
      diagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`)
        .join('\n'),
    );
    this.name = 'ApplicationPostgresProjectionError';
  }
}

export interface ApplicationPostgresCheckV1 {
  readonly constraintName: string;
  readonly expression: string;
  readonly semanticId: string;
}

export interface ApplicationPostgresColumnV1 {
  readonly checks: readonly ApplicationPostgresCheckV1[];
  readonly defaultSql?: string;
  readonly fieldId?: string;
  readonly nullable: boolean;
  readonly physicalName: string;
  readonly relationId?: string;
  readonly semanticId: string;
  readonly sqlType:
    | 'BOOLEAN'
    | 'BIGINT'
    | 'DATE'
    | 'DOUBLE PRECISION'
    | 'JSONB'
    | `NUMERIC(${number},${number})`
    | 'TEXT'
    | 'TIMESTAMPTZ';
}

export interface ApplicationPostgresForeignKeyV1 {
  readonly columnName: string;
  readonly constraintName: string;
  readonly relationId: string;
  readonly targetColumnName: string;
  readonly targetEntityId: string;
  readonly targetTableName: string;
}

export interface ApplicationPostgresUniqueConstraintV1 {
  readonly columnNames: readonly string[];
  readonly constraintId: string;
  readonly constraintName: string;
}

export interface ApplicationPostgresTableV1 {
  readonly columns: readonly ApplicationPostgresColumnV1[];
  readonly entityId: string;
  readonly foreignKeys: readonly ApplicationPostgresForeignKeyV1[];
  readonly physicalName: string;
  readonly primaryKey: {
    readonly columnName: string;
    readonly constraintName: string;
    readonly fieldId: string;
  };
  readonly uniques: readonly ApplicationPostgresUniqueConstraintV1[];
}

export interface ApplicationPostgresExternalReferenceV1 {
  readonly columnName: string;
  readonly entityId: string;
  readonly relationId: string;
  readonly tableEntityId: string;
}

export interface ApplicationPostgresSchemaV1 {
  readonly appId: string;
  readonly externalReferences: readonly ApplicationPostgresExternalReferenceV1[];
  readonly revision: number;
  readonly schemaName: string;
  readonly schemaVersion: 'oxe.application-postgres-schema.v1';
  readonly tables: readonly ApplicationPostgresTableV1[];
}

export interface ApplicationPostgresMigrationV1 {
  readonly appId: string;
  readonly fromRevision: number;
  readonly migrationId: string;
  readonly schemaVersion: 'oxe.application-postgres-migration.v1';
  readonly sql: string;
  readonly toRevision: number;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const fail = (
  code: ApplicationPostgresDiagnosticCode,
  path: string,
  message: string,
  semanticId?: string,
): never => {
  throw new ApplicationPostgresProjectionError([
    { code, message, path, ...(semanticId === undefined ? {} : { semanticId }) },
  ]);
};

const semanticStem = (semanticId: string): string => semanticId.split('.').at(-1) ?? semanticId;

const snakeCase = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase() || 'value';

const hashText = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const allocatedNames = (
  semanticIds: readonly string[],
  candidate: (semanticId: string) => string,
): ReadonlyMap<string, string> => {
  const candidates = new Map(semanticIds.map((id) => [id, candidate(id)]));
  const counts = new Map<string, number>();
  for (const value of candidates.values()) counts.set(value, (counts.get(value) ?? 0) + 1);
  return new Map(
    [...semanticIds]
      .sort(compareText)
      .map((id) => [
        id,
        counts.get(candidates.get(id) ?? '') === 1
          ? candidates.get(id)!
          : `${candidates.get(id)}_${hashText(id)}`,
      ]),
  );
};

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const sqlLiteral = (value: ApplicationScalarValueV1): string => {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
};

const constraintName = (prefix: string, semanticId: string, suffix = ''): string => {
  const readable = snakeCase(semanticStem(semanticId));
  const ending = suffix ? `_${suffix}` : '';
  const candidate = `${prefix}_${readable}${ending}`;
  return candidate.length <= 54 ? candidate : `${candidate.slice(0, 45)}_${hashText(candidate)}`;
};

const fieldColumn = (
  column: ApplicationDatabaseColumnV1,
  physicalName: string,
): ApplicationPostgresColumnV1 => {
  const checks: ApplicationPostgresCheckV1[] = [];
  if (column.type.kind === 'enum') {
    checks.push({
      constraintName: constraintName('ck', column.fieldId, 'enum'),
      expression: `${quoteIdentifier(physicalName)} IN (${column.type.values.map(sqlLiteral).join(', ')})`,
      semanticId: column.fieldId,
    });
  }
  if (column.type.kind === 'integer') {
    const bounds: string[] = [];
    if (column.type.minimum !== undefined)
      bounds.push(`${quoteIdentifier(physicalName)} >= ${column.type.minimum}`);
    if (column.type.maximum !== undefined)
      bounds.push(`${quoteIdentifier(physicalName)} <= ${column.type.maximum}`);
    if (bounds.length > 0)
      checks.push({
        constraintName: constraintName('ck', column.fieldId, 'integer'),
        expression: bounds.join(' AND '),
        semanticId: column.fieldId,
      });
  }
  for (const validation of column.validation ?? []) {
    const bounds: string[] = [];
    if (validation.minimum !== undefined)
      bounds.push(`char_length(${quoteIdentifier(physicalName)}) >= ${validation.minimum}`);
    if (validation.maximum !== undefined)
      bounds.push(`char_length(${quoteIdentifier(physicalName)}) <= ${validation.maximum}`);
    if (bounds.length > 0)
      checks.push({
        constraintName: constraintName('ck', column.fieldId, 'length'),
        expression: bounds.join(' AND '),
        semanticId: column.fieldId,
      });
  }
  const sqlType =
    column.type.kind === 'boolean'
      ? 'BOOLEAN'
      : column.type.kind === 'date'
        ? 'DATE'
        : column.type.kind === 'dateTime'
          ? 'TIMESTAMPTZ'
          : column.type.kind === 'decimal'
            ? (`NUMERIC(${column.type.precision},${column.type.scale})` as const)
            : column.type.kind === 'integer'
              ? 'BIGINT'
              : column.type.kind === 'json'
                ? 'JSONB'
                : column.type.kind === 'number'
                  ? 'DOUBLE PRECISION'
                  : 'TEXT';
  const defaultSql =
    column.default !== undefined
      ? column.type.kind === 'decimal' && typeof column.default === 'string'
        ? column.default
        : column.type.kind === 'json'
          ? `${sqlLiteral(JSON.stringify(column.default))}::jsonb`
          : sqlLiteral(column.default)
      : column.generation === 'current-date-time'
        ? 'CURRENT_TIMESTAMP'
        : undefined;
  return {
    checks,
    ...(defaultSql === undefined ? {} : { defaultSql }),
    fieldId: column.fieldId,
    nullable: column.nullable,
    physicalName,
    semanticId: column.fieldId,
    sqlType,
  };
};

interface RelationPlacement {
  readonly externalTarget: boolean;
  readonly relation: ApplicationDatabaseRelationV1;
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
}

const relationPlacement = (
  relation: ApplicationDatabaseRelationV1,
  tableIds: ReadonlySet<string>,
): RelationPlacement => {
  if (relation.from.cardinality === 'many' && relation.to.cardinality === 'many')
    return fail(
      'OXE2401',
      relation.sourcePath,
      `Many-to-many relation "${relation.relationId}" requires a join-table strategy that is not implemented yet.`,
      relation.relationId,
    );
  const source =
    relation.from.cardinality === 'one' && relation.to.cardinality === 'many'
      ? relation.from
      : relation.to.cardinality === 'one' && relation.from.cardinality === 'many'
        ? relation.to
        : relation.from.createValue
          ? relation.from
          : relation.to.createValue
            ? relation.to
            : relation.from;
  const target = source === relation.from ? relation.to : relation.from;
  if (!tableIds.has(source.entityId))
    return fail(
      'OXE2401',
      relation.sourcePath,
      `Relation "${relation.relationId}" would store its reference on external entity "${source.entityId}".`,
      relation.relationId,
    );
  return {
    externalTarget: !tableIds.has(target.entityId),
    relation,
    sourceEntityId: source.entityId,
    targetEntityId: target.entityId,
  };
};

const relationColumnCandidate = (relationId: string, sourceEntityId: string): string => {
  const relationStem = semanticStem(relationId);
  const entityStem = semanticStem(sourceEntityId);
  const withoutEntity = relationStem.toLowerCase().startsWith(entityStem.toLowerCase())
    ? relationStem.slice(entityStem.length)
    : relationStem;
  return `${snakeCase(withoutEntity)}_id`;
};

/** Lowers storage-neutral database IR into deterministic PostgreSQL-specific schema IR. */
export const lowerApplicationDatabaseSchemaToPostgres = (
  database: ApplicationDatabaseSchemaProjectionV1,
): ApplicationPostgresSchemaV1 => {
  const tableIds = new Set(database.tables.map((table) => table.entityId));
  const tableNames = allocatedNames(
    database.tables.map((table) => table.entityId),
    (id) => snakeCase(semanticStem(id)),
  );
  const placements = database.relations.map((relation) => relationPlacement(relation, tableIds));
  const externalReferences: ApplicationPostgresExternalReferenceV1[] = [];
  const tables = database.tables.map((table): ApplicationPostgresTableV1 => {
    const fieldNames = allocatedNames(
      table.columns.map((column) => column.fieldId),
      (id) => snakeCase(semanticStem(id)),
    );
    const tableRelations = placements.filter(
      (placement) => placement.sourceEntityId === table.entityId,
    );
    const relationNames = allocatedNames(
      tableRelations.map((placement) => placement.relation.relationId),
      (id) => relationColumnCandidate(id, table.entityId),
    );
    const columns = table.columns.map((column) =>
      fieldColumn(column, fieldNames.get(column.fieldId)!),
    );
    const foreignKeys: ApplicationPostgresForeignKeyV1[] = [];
    for (const placement of tableRelations) {
      const relation = placement.relation;
      const endpoint = relation.from.entityId === table.entityId ? relation.from : relation.to;
      const columnName = relationNames.get(relation.relationId)!;
      columns.push({
        checks: [],
        nullable: !endpoint.required,
        physicalName: columnName,
        relationId: relation.relationId,
        semanticId: relation.relationId,
        sqlType: 'TEXT',
      });
      if (placement.externalTarget) {
        externalReferences.push({
          columnName,
          entityId: placement.targetEntityId,
          relationId: relation.relationId,
          tableEntityId: table.entityId,
        });
      } else {
        const targetTable = database.tables.find(
          (candidate) => candidate.entityId === placement.targetEntityId,
        )!;
        const targetPrimaryKey = targetTable.columns.find(
          (column) => column.fieldId === targetTable.primaryKeyFieldId,
        )!;
        foreignKeys.push({
          columnName,
          constraintName: constraintName('fk', relation.relationId),
          relationId: relation.relationId,
          targetColumnName: snakeCase(semanticStem(targetPrimaryKey.fieldId)),
          targetEntityId: targetTable.entityId,
          targetTableName: tableNames.get(targetTable.entityId)!,
        });
      }
    }
    columns.sort((left, right) => compareText(left.semanticId, right.semanticId));
    foreignKeys.sort((left, right) => compareText(left.relationId, right.relationId));
    const primaryKeyColumn = columns.find((column) => column.fieldId === table.primaryKeyFieldId)!;
    const uniques = database.uniques
      .filter((unique) => unique.entityId === table.entityId)
      .map((unique): ApplicationPostgresUniqueConstraintV1 => ({
        columnNames: unique.keys.map((key) => {
          const column = columns.find((candidate) => candidate.semanticId === key);
          return column
            ? column.physicalName
            : fail(
                'OXE2402',
                unique.sourcePath,
                `PostgreSQL column for unique key "${key}" is unavailable.`,
                unique.constraintId,
              );
        }),
        constraintId: unique.constraintId,
        constraintName: constraintName('uq', unique.constraintId),
      }))
      .sort((left, right) => compareText(left.constraintId, right.constraintId));
    return {
      columns,
      entityId: table.entityId,
      foreignKeys,
      physicalName: tableNames.get(table.entityId)!,
      primaryKey: {
        columnName: primaryKeyColumn.physicalName,
        constraintName: constraintName('pk', table.entityId),
        fieldId: table.primaryKeyFieldId,
      },
      uniques,
    };
  });
  return {
    appId: database.appId,
    externalReferences: externalReferences.sort((left, right) =>
      compareText(left.relationId, right.relationId),
    ),
    revision: database.revision,
    schemaName: `oxe_${snakeCase(semanticStem(database.appId))}`,
    schemaVersion: 'oxe.application-postgres-schema.v1',
    tables: tables.sort((left, right) => compareText(left.entityId, right.entityId)),
  };
};

const qualifiedTable = (schema: ApplicationPostgresSchemaV1, tableName: string): string =>
  `${quoteIdentifier(schema.schemaName)}.${quoteIdentifier(tableName)}`;

const columnDefinition = (column: ApplicationPostgresColumnV1): string =>
  `${quoteIdentifier(column.physicalName)} ${column.sqlType}${column.nullable ? '' : ' NOT NULL'}${column.defaultSql === undefined ? '' : ` DEFAULT ${column.defaultSql}`}`;

const tableSql = (
  schema: ApplicationPostgresSchemaV1,
  table: ApplicationPostgresTableV1,
  includeForeignKeys = true,
): string => {
  const definitions = table.columns.map((column) => `  ${columnDefinition(column)}`);
  definitions.push(
    `  CONSTRAINT ${quoteIdentifier(table.primaryKey.constraintName)} PRIMARY KEY (${quoteIdentifier(table.primaryKey.columnName)})`,
  );
  for (const column of table.columns)
    for (const check of column.checks)
      definitions.push(
        `  CONSTRAINT ${quoteIdentifier(check.constraintName)} CHECK (${check.expression})`,
      );
  for (const unique of table.uniques)
    definitions.push(
      `  CONSTRAINT ${quoteIdentifier(unique.constraintName)} UNIQUE (${unique.columnNames.map(quoteIdentifier).join(', ')})`,
    );
  for (const foreignKey of includeForeignKeys ? table.foreignKeys : [])
    definitions.push(
      `  CONSTRAINT ${quoteIdentifier(foreignKey.constraintName)} FOREIGN KEY (${quoteIdentifier(foreignKey.columnName)}) REFERENCES ${qualifiedTable(schema, foreignKey.targetTableName)} (${quoteIdentifier(foreignKey.targetColumnName)})`,
    );
  return `CREATE TABLE ${qualifiedTable(schema, table.physicalName)} (\n${definitions.join(',\n')}\n);`;
};

const foreignKeySql = (
  schema: ApplicationPostgresSchemaV1,
  table: ApplicationPostgresTableV1,
  foreignKey: ApplicationPostgresForeignKeyV1,
): string =>
  `ALTER TABLE ${qualifiedTable(schema, table.physicalName)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.constraintName)} FOREIGN KEY (${quoteIdentifier(foreignKey.columnName)}) REFERENCES ${qualifiedTable(schema, foreignKey.targetTableName)} (${quoteIdentifier(foreignKey.targetColumnName)});`;

const applicationOutboxSql = (
  schema: ApplicationPostgresSchemaV1,
  ifNotExists = false,
): string => `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${qualifiedTable(schema, '__oxe_outbox_jobs')} (
  "id" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "execution_context" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL,
  "initial_delay_ms" DOUBLE PRECISION NOT NULL,
  "max_delay_ms" DOUBLE PRECISION NOT NULL,
  "backoff_multiplier" DOUBLE PRECISION NOT NULL,
  "jitter_ratio" DOUBLE PRECISION NOT NULL,
  "available_at" TIMESTAMPTZ NOT NULL,
  "lease_until" TIMESTAMPTZ,
  "worker_id" TEXT,
  "last_error_kind" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "pk_oxe_outbox_jobs" PRIMARY KEY ("id"),
  CONSTRAINT "ck_oxe_outbox_jobs_status" CHECK ("status" IN ('pending', 'running', 'completed', 'dead_letter')),
  CONSTRAINT "ck_oxe_outbox_jobs_attempts" CHECK ("attempts" >= 0 AND "max_attempts" >= 1),
  CONSTRAINT "ck_oxe_outbox_jobs_retry" CHECK ("initial_delay_ms" >= 0 AND "max_delay_ms" >= "initial_delay_ms" AND "backoff_multiplier" >= 1 AND "jitter_ratio" BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS ${quoteIdentifier('ix_oxe_outbox_jobs_claim')} ON ${qualifiedTable(schema, '__oxe_outbox_jobs')} ("status", "available_at", "created_at", "id");`;

/** Idempotent framework-owned tables versioned independently of application semantics. */
export const generateApplicationPostgresInfrastructureSql = (graph: ApplicationGraphV1): string =>
  `${applicationOutboxSql(compileApplicationPostgresSchema(graph), true)}\n`;

export const generateApplicationPostgresSchemaSql = (schema: ApplicationPostgresSchemaV1): string =>
  [
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema.schemaName)};`,
    applicationOutboxSql(schema),
    ...schema.tables.map((table) => tableSql(schema, table, false)),
    ...schema.tables.flatMap((table) =>
      table.foreignKeys.map((foreignKey) => foreignKeySql(schema, table, foreignKey)),
    ),
  ].join('\n\n') + '\n';

const tableFor = (
  schema: ApplicationPostgresSchemaV1,
  entityId: string,
): ApplicationPostgresTableV1 =>
  schema.tables.find((table) => table.entityId === entityId) ??
  fail('OXE2402', '$', `PostgreSQL table for "${entityId}" is unavailable.`, entityId);

/** Emits forward-only PostgreSQL SQL from OXE's already validated semantic migration plan. */
export const generateApplicationPostgresMigration = (
  plan: ApplicationDatabaseMigrationPlanV1,
  target: ApplicationPostgresSchemaV1,
): ApplicationPostgresMigrationV1 => {
  if (plan.appId !== target.appId || plan.toRevision !== target.revision)
    fail('OXE2402', '$', 'Migration plan and PostgreSQL target describe different revisions.');
  const statements: string[] = [];
  const addedTables: ApplicationPostgresTableV1[] = [];
  const operations = [
    ...plan.operations.filter((operation) => operation.type === 'table.add'),
    ...plan.operations.filter((operation) => operation.type !== 'table.add'),
  ];
  for (const operation of operations) {
    if (operation.type === 'table.add') {
      const table = tableFor(target, operation.table.entityId);
      statements.push(tableSql(target, table, false));
      addedTables.push(table);
      continue;
    }
    if (operation.type === 'column.add') {
      const table = tableFor(target, operation.entityId);
      const column =
        table.columns.find((candidate) => candidate.fieldId === operation.column.fieldId) ??
        fail(
          'OXE2402',
          operation.column.sourcePath,
          `PostgreSQL column for "${operation.column.fieldId}" is unavailable.`,
          operation.column.fieldId,
        );
      statements.push(
        `ALTER TABLE ${qualifiedTable(target, table.physicalName)} ADD COLUMN ${columnDefinition(column)};`,
      );
      for (const check of column.checks)
        statements.push(
          `ALTER TABLE ${qualifiedTable(target, table.physicalName)} ADD CONSTRAINT ${quoteIdentifier(check.constraintName)} CHECK (${check.expression});`,
        );
      continue;
    }
    if (operation.type === 'unique.add') {
      const table = tableFor(target, operation.unique.entityId);
      const unique =
        table.uniques.find(
          (candidate) => candidate.constraintId === operation.unique.constraintId,
        ) ??
        fail(
          'OXE2402',
          operation.unique.sourcePath,
          `PostgreSQL unique constraint for "${operation.unique.constraintId}" is unavailable.`,
          operation.unique.constraintId,
        );
      statements.push(
        `ALTER TABLE ${qualifiedTable(target, table.physicalName)} ADD CONSTRAINT ${quoteIdentifier(unique.constraintName)} UNIQUE (${unique.columnNames.map(quoteIdentifier).join(', ')});`,
      );
      continue;
    }
    const table =
      target.tables.find((candidate) =>
        candidate.columns.some((column) => column.relationId === operation.relation.relationId),
      ) ??
      fail(
        'OXE2402',
        operation.relation.sourcePath,
        `PostgreSQL relation table for "${operation.relation.relationId}" is unavailable.`,
        operation.relation.relationId,
      );
    const column =
      table.columns.find((candidate) => candidate.relationId === operation.relation.relationId) ??
      fail(
        'OXE2402',
        operation.relation.sourcePath,
        `PostgreSQL relation column for "${operation.relation.relationId}" is unavailable.`,
        operation.relation.relationId,
      );
    statements.push(
      `ALTER TABLE ${qualifiedTable(target, table.physicalName)} ADD COLUMN ${columnDefinition(column)};`,
    );
    const foreignKey = table.foreignKeys.find(
      (candidate) => candidate.relationId === operation.relation.relationId,
    );
    if (foreignKey)
      statements.push(
        `ALTER TABLE ${qualifiedTable(target, table.physicalName)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.constraintName)} FOREIGN KEY (${quoteIdentifier(foreignKey.columnName)}) REFERENCES ${qualifiedTable(target, foreignKey.targetTableName)} (${quoteIdentifier(foreignKey.targetColumnName)});`,
      );
  }
  for (const table of addedTables)
    for (const foreignKey of table.foreignKeys)
      statements.push(foreignKeySql(target, table, foreignKey));
  return {
    appId: plan.appId,
    fromRevision: plan.fromRevision,
    migrationId: `r${plan.fromRevision}-r${plan.toRevision}`,
    schemaVersion: 'oxe.application-postgres-migration.v1',
    sql: statements.length === 0 ? '-- No database changes.\n' : `${statements.join('\n')}\n`,
    toRevision: plan.toRevision,
  };
};

export const compileApplicationPostgresSchema = (
  graph: ApplicationGraphV1,
): ApplicationPostgresSchemaV1 =>
  lowerApplicationDatabaseSchemaToPostgres(lowerApplicationGraphToDatabaseSchema(graph));

export const compileApplicationPostgresBootstrap = (
  graph: ApplicationGraphV1,
): ApplicationPostgresMigrationV1 => {
  const schema = compileApplicationPostgresSchema(graph);
  if (schema.revision <= 0)
    fail(
      'OXE2402',
      '$.revision',
      'A PostgreSQL bootstrap migration requires a positive application revision.',
      schema.appId,
    );
  return {
    appId: schema.appId,
    fromRevision: 0,
    migrationId: `bootstrap-r${schema.revision}`,
    schemaVersion: 'oxe.application-postgres-migration.v1',
    sql: generateApplicationPostgresSchemaSql(schema),
    toRevision: schema.revision,
  };
};

export const compileApplicationPostgresMigration = (
  fromGraph: ApplicationGraphV1,
  toGraph: ApplicationGraphV1,
): ApplicationPostgresMigrationV1 => {
  const migration = generateApplicationPostgresMigration(
    planApplicationDatabaseMigration(fromGraph, toGraph),
    compileApplicationPostgresSchema(toGraph),
  );
  const hasQueuedDelivery = (graph: ApplicationGraphV1): boolean =>
    graph.operations.some(
      (operation) =>
        operation.body.kind === 'workflow' &&
        operation.body.steps.some((step) => step.kind === 'enqueueCapability'),
    );
  if (hasQueuedDelivery(fromGraph) || !hasQueuedDelivery(toGraph)) return migration;
  const schema = compileApplicationPostgresSchema(toGraph);
  const infrastructure = applicationOutboxSql(schema, true);
  return { ...migration, sql: `${infrastructure}\n${migration.sql}` };
};
