import type { Client, PoolClient } from 'pg';

import { connectPostgres } from '../apply/connect-postgres.js';
import { DATABASE_SNAPSHOT_FORMAT_VERSION, type DatabaseSnapshot } from '../snapshot/types.js';
import { OXE_MIGRATIONS_TABLE } from '../tracking/constants.js';
import type { IntrospectDatabaseSnapshotOptions } from './types.js';

const sortRecordByKey = <TValue>(record: Record<string, TValue>): Record<string, TValue> =>
  Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));

const normalizeDefault = (defaultExpression: string | null | undefined) => {
  if (!defaultExpression) {
    return undefined;
  }

  const value = defaultExpression.trim();
  if (/^(now\(\)|current_timestamp)(::.+)?$/i.test(value)) {
    return {
      kind: 'raw_sql' as const,
      sql: 'now()',
    };
  }

  const textLiteralWithCast = value.match(/^'((?:''|[^'])*)'::.+$/);
  if (textLiteralWithCast) {
    return {
      kind: 'literal' as const,
      value: textLiteralWithCast[1].replace(/''/g, "'"),
    };
  }

  const plainTextLiteral = value.match(/^'((?:''|[^'])*)'$/);
  if (plainTextLiteral) {
    return {
      kind: 'literal' as const,
      value: plainTextLiteral[1].replace(/''/g, "'"),
    };
  }

  if (/^(true|false)(::.+)?$/i.test(value)) {
    return {
      kind: 'literal' as const,
      value: value.toLowerCase().startsWith('true'),
    };
  }

  const numeric = value.match(/^(-?\d+(?:\.\d+)?)(::.+)?$/);
  if (numeric) {
    return {
      kind: 'literal' as const,
      value: Number(numeric[1]),
    };
  }

  return {
    kind: 'raw_sql' as const,
    sql: value,
  };
};

const mapOnDeleteRule = (
  deleteRule: string | null | undefined,
): 'CASCADE' | 'RESTRICT' | 'SET NULL' | undefined => {
  if (!deleteRule) {
    return undefined;
  }

  if (deleteRule === 'CASCADE') {
    return 'CASCADE';
  }
  if (deleteRule === 'SET NULL') {
    return 'SET NULL';
  }
  if (deleteRule === 'RESTRICT' || deleteRule === 'NO ACTION') {
    return 'RESTRICT';
  }
  return undefined;
};

const mapBaseType = (udtName: string, dataType: string): string => {
  switch (udtName) {
    case 'uuid':
      return 'uuid';
    case 'text':
    case 'varchar':
    case 'bpchar':
      return 'text';
    case 'bool':
      return 'boolean';
    case 'int2':
    case 'int4':
      return 'integer';
    case 'int8':
      return 'bigint';
    case 'float4':
      return 'real';
    case 'float8':
      return 'double precision';
    case 'numeric':
      return 'numeric';
    case 'timestamptz':
      return 'timestamptz';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'json':
    case 'jsonb':
      return 'jsonb';
    case 'bytea':
      return 'bytea';
    default:
      return dataType === 'USER-DEFINED' ? udtName : dataType.toLowerCase();
  }
};

const resolveColumnType = (
  dataType: string,
  udtName: string,
  enumTypeNames: Set<string>,
): {
  postgresType: string;
  enumDbName?: string;
  isArray: boolean;
} => {
  if (dataType === 'ARRAY') {
    const base = udtName.startsWith('_') ? udtName.slice(1) : udtName;
    if (enumTypeNames.has(base)) {
      return {
        postgresType: base,
        enumDbName: base,
        isArray: true,
      };
    }
    return {
      postgresType: mapBaseType(base, base),
      isArray: true,
    };
  }

  if (dataType === 'USER-DEFINED' && enumTypeNames.has(udtName)) {
    return {
      postgresType: udtName,
      enumDbName: udtName,
      isArray: false,
    };
  }

  return {
    postgresType: mapBaseType(udtName, dataType),
    isArray: false,
  };
};

const loadEnums = async (
  client: Client | PoolClient,
  schema: string,
): Promise<DatabaseSnapshot['enums']> => {
  const result = await client.query<{
    enum_name: string;
    enum_value: string;
    enum_sort_order: number;
  }>(
    `SELECT
       t.typname AS enum_name,
       e.enumlabel AS enum_value,
       e.enumsortorder AS enum_sort_order
     FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = $1
     ORDER BY t.typname ASC, e.enumsortorder ASC;`,
    [schema],
  );

  const grouped = new Map<string, string[]>();
  for (const row of result.rows) {
    const current = grouped.get(row.enum_name) ?? [];
    current.push(row.enum_value);
    grouped.set(row.enum_name, current);
  }

  return sortRecordByKey(
    Object.fromEntries(
      [...grouped.entries()].map(([enumName, values]) => [
        enumName,
        {
          name: enumName,
          dbName: enumName,
          values,
          sourcePath: '<introspected>',
        },
      ]),
    ),
  );
};

const loadPrimaryKey = async (
  client: Client | PoolClient,
  schema: string,
  tableName: string,
): Promise<{ name: string; columns: string[] } | undefined> => {
  const result = await client.query<{
    constraint_name: string;
    column_name: string;
    ordinal_position: number;
  }>(
    `SELECT
       tc.constraint_name,
       kcu.column_name,
       kcu.ordinal_position
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
      AND kcu.table_name = tc.table_name
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position ASC;`,
    [schema, tableName],
  );

  if (result.rows.length === 0) {
    return undefined;
  }

  return {
    name: result.rows[0].constraint_name,
    columns: result.rows.map((row) => row.column_name),
  };
};

const loadUniqueConstraints = async (
  client: Client | PoolClient,
  schema: string,
  tableName: string,
): Promise<Record<string, { name: string; columns: string[] }>> => {
  const result = await client.query<{
    constraint_name: string;
    column_name: string;
    ordinal_position: number;
  }>(
    `SELECT
       tc.constraint_name,
       kcu.column_name,
       kcu.ordinal_position
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
      AND kcu.table_name = tc.table_name
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'UNIQUE'
     ORDER BY tc.constraint_name ASC, kcu.ordinal_position ASC;`,
    [schema, tableName],
  );

  const grouped = new Map<string, string[]>();
  for (const row of result.rows) {
    const current = grouped.get(row.constraint_name) ?? [];
    current.push(row.column_name);
    grouped.set(row.constraint_name, current);
  }

  return sortRecordByKey(
    Object.fromEntries(
      [...grouped.entries()].map(([name, columns]) => [
        name,
        {
          name,
          columns,
        },
      ]),
    ),
  );
};

const loadIndexes = async (
  client: Client | PoolClient,
  schema: string,
  tableName: string,
): Promise<Record<string, { name: string; columns: string[] }>> => {
  const result = await client.query<{
    index_name: string;
    columns: string[] | null;
  }>(
    `SELECT
       i.relname AS index_name,
       array_agg(a.attname ORDER BY ord.ordinality) AS columns
     FROM pg_class t
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_index ix ON ix.indrelid = t.oid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN unnest(ix.indkey) WITH ORDINALITY AS ord(attnum, ordinality) ON TRUE
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ord.attnum
     WHERE n.nspname = $1
       AND t.relname = $2
       AND ix.indisprimary = FALSE
       AND ix.indisunique = FALSE
     GROUP BY i.relname
     ORDER BY i.relname ASC;`,
    [schema, tableName],
  );

  return sortRecordByKey(
    Object.fromEntries(
      result.rows.map((row) => [
        row.index_name,
        {
          name: row.index_name,
          columns: row.columns ?? [],
        },
      ]),
    ),
  );
};

const loadForeignKeys = async (
  client: Client | PoolClient,
  schema: string,
  tableName: string,
): Promise<
  Record<
    string,
    {
      name: string;
      columns: string[];
      referencedTable: string;
      referencedColumns: string[];
      onDelete?: 'CASCADE' | 'RESTRICT' | 'SET NULL';
    }
  >
> => {
  const result = await client.query<{
    constraint_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    delete_rule: string | null;
    ordinal_position: number;
  }>(
    `SELECT
       tc.constraint_name,
       kcu.column_name,
       ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name,
       rc.delete_rule,
       kcu.ordinal_position
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
      AND kcu.table_name = tc.table_name
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_schema = tc.constraint_schema
      AND ccu.constraint_name = tc.constraint_name
     JOIN information_schema.referential_constraints rc
       ON rc.constraint_schema = tc.constraint_schema
      AND rc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.constraint_name ASC, kcu.ordinal_position ASC;`,
    [schema, tableName],
  );

  const grouped = new Map<
    string,
    {
      columns: string[];
      referencedColumns: string[];
      referencedTable: string;
      onDelete?: 'CASCADE' | 'RESTRICT' | 'SET NULL';
    }
  >();

  for (const row of result.rows) {
    const current = grouped.get(row.constraint_name) ?? {
      columns: [],
      referencedColumns: [],
      referencedTable: row.foreign_table_name,
      onDelete: mapOnDeleteRule(row.delete_rule),
    };
    current.columns.push(row.column_name);
    current.referencedColumns.push(row.foreign_column_name);
    grouped.set(row.constraint_name, current);
  }

  return sortRecordByKey(
    Object.fromEntries(
      [...grouped.entries()].map(([name, entry]) => [
        name,
        {
          name,
          columns: entry.columns,
          referencedTable: entry.referencedTable,
          referencedColumns: entry.referencedColumns,
          onDelete: entry.onDelete,
        },
      ]),
    ),
  );
};

const loadTables = async (
  client: Client | PoolClient,
  schema: string,
  enumTypeNames: Set<string>,
): Promise<DatabaseSnapshot['tables']> => {
  const tablesResult = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type = 'BASE TABLE'
       AND table_name <> $2
     ORDER BY table_name ASC;`,
    [schema, OXE_MIGRATIONS_TABLE],
  );

  const tables: DatabaseSnapshot['tables'] = {};

  for (const row of tablesResult.rows) {
    const tableName = row.table_name;
    const columnsResult = await client.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
    }>(
      `SELECT
         column_name,
         data_type,
         udt_name,
         is_nullable,
         column_default
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = $2
       ORDER BY ordinal_position ASC;`,
      [schema, tableName],
    );

    const columns = sortRecordByKey(
      Object.fromEntries(
        columnsResult.rows.map((column) => {
          const resolvedType = resolveColumnType(column.data_type, column.udt_name, enumTypeNames);
          return [
            column.column_name,
            {
              name: column.column_name,
              postgresType: resolvedType.postgresType,
              enumDbName: resolvedType.enumDbName,
              isArray: resolvedType.isArray,
              nullable: column.is_nullable === 'YES',
              default: normalizeDefault(column.column_default),
              isPrimaryKey: false,
              sourcePath: '<introspected>',
              declaration: tableName,
              builtIn: false,
            },
          ];
        }),
      ),
    );

    const primaryKey = await loadPrimaryKey(client, schema, tableName);
    if (primaryKey) {
      for (const columnName of primaryKey.columns) {
        const column = columns[columnName];
        if (column) {
          column.isPrimaryKey = true;
        }
      }
    }

    tables[tableName] = {
      name: tableName,
      dbName: tableName,
      sourcePath: '<introspected>',
      columns,
      primaryKey,
      indexes: await loadIndexes(client, schema, tableName),
      uniqueConstraints: await loadUniqueConstraints(client, schema, tableName),
      foreignKeys: await loadForeignKeys(client, schema, tableName),
    };
  }

  return sortRecordByKey(tables);
};

export const introspectDatabaseSnapshot = async (
  options: IntrospectDatabaseSnapshotOptions = {},
): Promise<DatabaseSnapshot> => {
  const schema = options.schema ?? 'public';
  const client = await connectPostgres(options);
  try {
    const enums = await loadEnums(client, schema);
    const enumTypeNames = new Set(Object.values(enums).map((entry) => entry.dbName));
    const tables = await loadTables(client, schema, enumTypeNames);

    return {
      formatVersion: DATABASE_SNAPSHOT_FORMAT_VERSION,
      generatedFromRootDir: '<database>',
      enums,
      tables,
    };
  } finally {
    await client.end();
  }
};
