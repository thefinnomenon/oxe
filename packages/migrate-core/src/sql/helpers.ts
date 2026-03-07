import type {
  DatabaseColumnDefault,
  DatabaseColumnSnapshot,
  DatabaseForeignKeySnapshot,
} from '../snapshot/types.js';

export const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, '""')}"`;

export const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const renderJsonLiteral = (value: unknown): string => quoteLiteral(JSON.stringify(value));

export const renderColumnType = (column: DatabaseColumnSnapshot): string => {
  const baseType = column.enumDbName ? quoteIdentifier(column.enumDbName) : column.postgresType;
  return column.isArray ? `${baseType}[]` : baseType;
};

export const renderColumnDefault = (
  defaultValue: DatabaseColumnDefault | undefined,
  column: DatabaseColumnSnapshot,
): string | undefined => {
  if (!defaultValue) {
    return undefined;
  }

  if (defaultValue.kind === 'raw_sql') {
    return defaultValue.sql;
  }

  const literal = defaultValue.value;

  if (literal === null) {
    return 'NULL';
  }

  if (typeof literal === 'number') {
    return Number.isFinite(literal) ? String(literal) : undefined;
  }

  if (typeof literal === 'boolean') {
    return literal ? 'TRUE' : 'FALSE';
  }

  if (typeof literal === 'string') {
    if (column.enumDbName) {
      return `${quoteLiteral(literal)}::${quoteIdentifier(column.enumDbName)}`;
    }

    return quoteLiteral(literal);
  }

  if (column.postgresType === 'jsonb') {
    return `${renderJsonLiteral(literal)}::jsonb`;
  }

  return undefined;
};

export const renderColumnDefinition = (column: DatabaseColumnSnapshot): string => {
  const parts = [
    quoteIdentifier(column.name),
    renderColumnType(column),
    column.nullable ? 'NULL' : 'NOT NULL',
  ];

  const renderedDefault = renderColumnDefault(column.default, column);

  if (renderedDefault) {
    parts.push(`DEFAULT ${renderedDefault}`);
  }

  return parts.join(' ');
};

export const renderForeignKeyClause = (foreignKey: DatabaseForeignKeySnapshot): string => {
  const columnList = foreignKey.columns.map((column) => quoteIdentifier(column)).join(', ');
  const referencedColumns = foreignKey.referencedColumns
    .map((column) => quoteIdentifier(column))
    .join(', ');

  const onDeleteClause = foreignKey.onDelete ? ` ON DELETE ${foreignKey.onDelete}` : '';

  return `CONSTRAINT ${quoteIdentifier(foreignKey.name)} FOREIGN KEY (${columnList}) REFERENCES ${quoteIdentifier(foreignKey.referencedTable)} (${referencedColumns})${onDeleteClause}`;
};
