import type { NormalizedField, OnDeleteBehavior, SchemaGraph } from '@oxe/schema-core';

import { normalizeDefaultValue } from './defaults.js';
import {
  buildCompositeIndexName,
  buildCompositeUniqueName,
  buildEnumTypeName,
  buildForeignKeyName,
  buildIndexName,
  buildPrimaryKeyName,
  buildUniqueName,
} from './naming.js';
import {
  DATABASE_SNAPSHOT_FORMAT_VERSION,
  type DatabaseColumnSnapshot,
  type DatabaseIndexSnapshot,
  type DatabaseOnDeleteAction,
  type DatabaseSnapshot,
  type DatabaseTableSnapshot,
  type DatabaseUniqueConstraintSnapshot,
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
    renameFrom: field.db.renameFrom,
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
  tableDbNameByName: Record<string, string>,
  enumDbTypeNamesByEnumName: Record<string, string>,
): DatabaseTableSnapshot => {
  const tableDbName = (table as { metadata?: { dbName?: string } }).metadata?.dbName ?? tableName;
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

  const indexEntries: Array<[string, DatabaseIndexSnapshot]> = [
    ...Object.values(table.fields)
      .filter((field) => field.db.index)
      .map((field) => {
        const indexName = buildIndexName(tableDbName, field.name);
        return [
          indexName,
          {
            name: indexName,
            columns: [field.name],
          },
        ] as [string, DatabaseIndexSnapshot];
      }),
    ...(table.compositeIndexes ?? []).map((composite) => {
      const indexName = composite.name ?? buildCompositeIndexName(tableDbName, composite.columns);
      return [
        indexName,
        {
          name: indexName,
          columns: [...composite.columns],
        },
      ] as [string, DatabaseIndexSnapshot];
    }),
  ];
  const indexes = sortRecordByKey(Object.fromEntries(indexEntries));

  const uniqueEntries: Array<[string, DatabaseUniqueConstraintSnapshot]> = [
    ...Object.values(table.fields)
      .filter((field) => field.db.unique)
      .map((field) => {
        const uniqueName = buildUniqueName(tableDbName, field.name);
        return [
          uniqueName,
          {
            name: uniqueName,
            columns: [field.name],
          },
        ] as [string, DatabaseUniqueConstraintSnapshot];
      }),
    ...(table.compositeUniques ?? []).map((composite) => {
      const uniqueName = composite.name ?? buildCompositeUniqueName(tableDbName, composite.columns);
      return [
        uniqueName,
        {
          name: uniqueName,
          columns: [...composite.columns],
        },
      ] as [string, DatabaseUniqueConstraintSnapshot];
    }),
  ];
  const uniqueConstraints = sortRecordByKey(Object.fromEntries(uniqueEntries));

  const foreignKeys = sortRecordByKey(
    Object.fromEntries(
      Object.values(table.fields)
        .filter((field) => Boolean(field.relationship?.targetTable))
        .map((field) => {
          const relationship = field.relationship;

          if (!relationship) {
            throw new Error(`Relationship metadata missing for field "${field.name}".`);
          }

          const foreignKeyName = buildForeignKeyName(tableDbName, field.name);
          const referencedTableDbName =
            tableDbNameByName[relationship.targetTable] ?? relationship.targetTable;

          return [
            foreignKeyName,
            {
              name: foreignKeyName,
              columns: [field.name],
              referencedTable: referencedTableDbName,
              referencedColumns: ['id'],
              onDelete: mapOnDelete(relationship.onDelete),
            },
          ];
        }),
    ),
  );

  return {
    name: tableName,
    renameFrom: table.renameFrom,
    dbName: tableDbName,
    sourcePath: table.sourcePath,
    columns,
    primaryKey:
      primaryKeyColumns.length > 0
        ? {
            name: buildPrimaryKeyName(tableDbName),
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

  const tableDbNameByName: Record<string, string> = Object.fromEntries(
    Object.entries(schemaGraph.tables).map(([tableName, table]) => [
      tableName,
      (table as { metadata?: { dbName?: string } }).metadata?.dbName ?? tableName,
    ]),
  );

  const tables = sortRecordByKey(
    Object.fromEntries(
      Object.entries(schemaGraph.tables)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tableName, table]) => [
          tableName,
          buildTableSnapshot(tableName, table, tableDbNameByName, enumDbTypeNamesByEnumName),
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
