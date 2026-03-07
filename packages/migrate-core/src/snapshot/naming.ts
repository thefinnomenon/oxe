const stripRepeatedUnderscores = (value: string): string =>
  value.replace(/__+/g, '_').replace(/^_+|_+$/g, '');

export const toSnakeCase = (value: string): string => {
  return stripRepeatedUnderscores(
    value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .toLowerCase(),
  );
};

export const buildEnumTypeName = (enumName: string): string => `enum_${toSnakeCase(enumName)}`;

export const buildPrimaryKeyName = (tableName: string): string => `${toSnakeCase(tableName)}_pkey`;

export const buildIndexName = (tableName: string, columnName: string): string =>
  `${toSnakeCase(tableName)}_${toSnakeCase(columnName)}_idx`;

export const buildUniqueName = (tableName: string, columnName: string): string =>
  `${toSnakeCase(tableName)}_${toSnakeCase(columnName)}_key`;

export const buildForeignKeyName = (tableName: string, columnName: string): string =>
  `${toSnakeCase(tableName)}_${toSnakeCase(columnName)}_fkey`;
