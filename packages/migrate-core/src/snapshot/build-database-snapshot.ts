import type { NormalizedField, OnDeleteBehavior, SchemaGraph } from '@oxe/schema-core';

import { normalizeDefaultValue } from './defaults.js';
import {
  buildEnumTypeName,
  buildForeignKeyName,
  buildIndexName,
  buildPrimaryKeyName,
  buildUniqueName,
} from './naming.js';
import {
  DATABASE_SNAPSHOT_FORMAT_VERSION,
  type DatabaseColumnSnapshot,
  type DatabaseOnDeleteAction,
  type DatabaseSnapshot,
  type DatabaseTableSnapshot,
} from './types.js';

const mapOnDelete = (
  onDelete: OnDeleteBehavior | undefined,
): DatabaseOnDeleteAction | undefined => {
  if (!onDelete) {
    return undefined;
  }

  if (onDelete === 'cascade') {
    return 'CASCADE';
  }

  if (onDelete === 'restrict') {
    return 'RESTRICT';
  }

  return 'SET NULL';
};

const scalarToPostgresType = (
  scalar: Extract<NormalizedField['type'], { kind: 'scalar' }>,
): string => {
  switch (scalar.scalar) {
    case 'id':
      return 'uuid';
    case 'string':
      return 'text';
    case 'boolean':
      return 'boolean';
    case 'int':
      return 'integer';
    case 'float':
      return 'double precision';
    case 'decimal':
      return 'numeric';
    case 'datetime':
      return 'timestamptz';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'json':
      return 'jsonb';
    case 'bytes':
      return 'bytea';
    default:
      throw new Error(
        `Unsupported scalar type mapping: ${(scalar as { scalar?: string }).scalar ?? 'unknown'}`,
      );
  }
};

const mapFieldToColumnSnapshot = (
  field: NormalizedField,
  enumDbTypeNamesByEnumName: Record<string, string>,
): DatabaseColumnSnapshot => {
  let postgresType: string;
  let enumDbName: string | undefined;
  let isArray = field.array;

  if (field.type.kind === 'scalar') {
    postgresType = scalarToPostgresType(field.type);
  } else if (field.type.kind === 'enum') {
    enumDbName = enumDbTypeNamesByEnumName[field.type.enumName];

    if (!enumDbName) {
      throw new Error(`Unknown enum "${field.type.enumName}" while building database snapshot.`);
    }

    postgresType = enumDbName;
  } else {
    // v1 behavior: object and object[] fields are both stored as jsonb columns.
    postgresType = 'jsonb';
    isArray = false;
  }

  return {
    name: field.name,
    postgresType,
    enumDbName,
    isArray,
    nullable: field.optional,
    default: normalizeDefaultValue(field.db.defaultValue),
    isPrimaryKey: field.db.primary,
    sourcePath: field.provenance.sourcePath,
    declaration: field.provenance.declaration,
    builtIn: field.provenance.builtIn,
  };
};

const sortRecordByKey = <TValue>(record: Record<string, TValue>): Record<string, TValue> => {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
};

const buildTableSnapshot = (
  tableName: string,
  table: SchemaGraph['tables'][string],
  enumDbTypeNamesByEnumName: Record<string, string>,
): DatabaseTableSnapshot => {
  const columns = sortRecordByKey(
    Object.fromEntries(
      Object.entries(table.fields).map(([fieldName, field]) => [
        fieldName,
        mapFieldToColumnSnapshot(field, enumDbTypeNamesByEnumName),
      ]),
    ),
  );

  const primaryKeyColumns = Object.values(columns)
    .filter((column) => column.isPrimaryKey)
    .map((column) => column.name)
    .sort((a, b) => a.localeCompare(b));

  const indexes = sortRecordByKey(
    Object.fromEntries(
      Object.values(table.fields)
        .filter((field) => field.db.index)
        .map((field) => {
          const indexName = buildIndexName(tableName, field.name);
          return [
            indexName,
            {
              name: indexName,
              columns: [field.name],
            },
          ];
        }),
    ),
  );

  const uniqueConstraints = sortRecordByKey(
    Object.fromEntries(
      Object.values(table.fields)
        .filter((field) => field.db.unique)
        .map((field) => {
          const uniqueName = buildUniqueName(tableName, field.name);
          return [
            uniqueName,
            {
              name: uniqueName,
              columns: [field.name],
            },
          ];
        }),
    ),
  );

  const foreignKeys = sortRecordByKey(
    Object.fromEntries(
      Object.values(table.fields)
        .filter((field) => Boolean(field.relationship?.targetTable))
        .map((field) => {
          const relationship = field.relationship;

          if (!relationship) {
            throw new Error(`Relationship metadata missing for field "${field.name}".`);
          }

          const foreignKeyName = buildForeignKeyName(tableName, field.name);

          return [
            foreignKeyName,
            {
              name: foreignKeyName,
              columns: [field.name],
              referencedTable: relationship.targetTable,
              referencedColumns: ['id'],
              onDelete: mapOnDelete(relationship.onDelete),
            },
          ];
        }),
    ),
  );

  return {
    name: tableName,
    dbName: tableName,
    sourcePath: table.sourcePath,
    columns,
    primaryKey:
      primaryKeyColumns.length > 0
        ? {
            name: buildPrimaryKeyName(tableName),
            columns: primaryKeyColumns,
          }
        : undefined,
    indexes,
    uniqueConstraints,
    foreignKeys,
  };
};

export const buildDatabaseSnapshot = (schemaGraph: SchemaGraph): DatabaseSnapshot => {
  const enumEntries = Object.entries(schemaGraph.enums).sort(([a], [b]) => a.localeCompare(b));

  const enumDbTypeNamesByEnumName: Record<string, string> = Object.fromEntries(
    enumEntries.map(([enumName]) => [enumName, buildEnumTypeName(enumName)]),
  );

  const enums = sortRecordByKey(
    Object.fromEntries(
      enumEntries.map(([enumName, enumValue]) => [
        enumName,
        {
          name: enumName,
          dbName: enumDbTypeNamesByEnumName[enumName],
          values: [...enumValue.members],
          sourcePath: enumValue.sourcePath,
        },
      ]),
    ),
  );

  const tables = sortRecordByKey(
    Object.fromEntries(
      Object.entries(schemaGraph.tables)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tableName, table]) => [
          tableName,
          buildTableSnapshot(tableName, table, enumDbTypeNamesByEnumName),
        ]),
    ),
  );

  return {
    formatVersion: DATABASE_SNAPSHOT_FORMAT_VERSION,
    generatedFromRootDir: schemaGraph.rootDir,
    enums,
    tables,
  };
};
