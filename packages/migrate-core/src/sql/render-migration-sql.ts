import type { MigrationPlan } from '../operations/types.js';
import type { MigrationOperation } from '../operations/types.js';
import {
  quoteIdentifier,
  quoteLiteral,
  renderColumnDefault,
  renderColumnDefinition,
  renderColumnType,
  renderForeignKeyClause,
} from './helpers.js';

export interface RenderMigrationSqlOptions {
  includeTransaction?: boolean;
  abortOnBlockedPlan?: boolean;
}

const renderCreateTable = (
  operation: Extract<MigrationOperation, { kind: 'create_table' }>,
): string => {
  const columns = Object.values(operation.table.columns).map(
    (column) => `  ${renderColumnDefinition(column)}`,
  );

  if (operation.table.primaryKey) {
    const primaryColumns = operation.table.primaryKey.columns
      .map((column) => quoteIdentifier(column))
      .join(', ');

    columns.push(
      `  CONSTRAINT ${quoteIdentifier(operation.table.primaryKey.name)} PRIMARY KEY (${primaryColumns})`,
    );
  }

  return `CREATE TABLE ${quoteIdentifier(operation.table.dbName)} (\n${columns.join(',\n')}\n);`;
};

const renderOperationSql = (operation: MigrationOperation): string[] => {
  switch (operation.kind) {
    case 'create_enum': {
      const values = operation.enum.values.map((value) => quoteLiteral(value)).join(', ');
      return [`CREATE TYPE ${quoteIdentifier(operation.enum.dbName)} AS ENUM (${values});`];
    }
    case 'drop_enum': {
      return [`DROP TYPE ${quoteIdentifier(operation.enum.dbName)};`];
    }
    case 'append_enum_value': {
      return [
        `ALTER TYPE ${quoteIdentifier(operation.enumDbName)} ADD VALUE IF NOT EXISTS ${quoteLiteral(operation.value)};`,
      ];
    }
    case 'create_table': {
      return [renderCreateTable(operation)];
    }
    case 'drop_table': {
      return [`DROP TABLE ${quoteIdentifier(operation.table.dbName)};`];
    }
    case 'add_column': {
      return [
        `ALTER TABLE ${quoteIdentifier(operation.tableName)} ADD COLUMN ${renderColumnDefinition(operation.column)};`,
      ];
    }
    case 'drop_column': {
      return [
        `ALTER TABLE ${quoteIdentifier(operation.tableName)} DROP COLUMN ${quoteIdentifier(operation.column.name)};`,
      ];
    }
    case 'alter_column_type': {
      return [
        `ALTER TABLE ${quoteIdentifier(operation.tableName)} ALTER COLUMN ${quoteIdentifier(operation.columnName)} TYPE ${renderColumnType(operation.next)} USING ${quoteIdentifier(operation.columnName)}::${renderColumnType(operation.next)};`,
      ];
    }
    case 'alter_column_nullability': {
      return [
        `ALTER TABLE ${quoteIdentifier(operation.tableName)} ALTER COLUMN ${quoteIdentifier(operation.columnName)} ${operation.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`,
      ];
    }
    case 'alter_column_default': {
      const renderedDefault = renderColumnDefault(operation.default, operation.column);
      return [
        renderedDefault
          ? `ALTER TABLE ${quoteIdentifier(operation.tableName)} ALTER COLUMN ${quoteIdentifier(operation.columnName)} SET DEFAULT ${renderedDefault};`
          : `ALTER TABLE ${quoteIdentifier(operation.tableName)} ALTER COLUMN ${quoteIdentifier(operation.columnName)} DROP DEFAULT;`,
      ];
    }
    case 'add_index': {
      const columns = operation.index.columns.map((column) => quoteIdentifier(column)).join(', ');
      return [
        `CREATE INDEX ${quoteIdentifier(operation.index.name)} ON ${quoteIdentifier(operation.tableName)} (${columns});`,
      ];
    }
    case 'drop_index': {
      return [`DROP INDEX ${quoteIdentifier(operation.index.name)};`];
    }
    case 'add_unique': {
      const columns = operation.unique.columns.map((column) => quoteIdentifier(column)).join(', ');
      return [
        `ALTER TABLE ${quoteIdentifier(operation.tableName)} ADD CONSTRAINT ${quoteIdentifier(operation.unique.name)} UNIQUE (${columns});`,
      ];
    }
    case 'drop_unique': {
      return [
        `ALTER TABLE ${quoteIdentifier(operation.tableName)} DROP CONSTRAINT ${quoteIdentifier(operation.unique.name)};`,
      ];
    }
    case 'add_foreign_key': {
      return [
        `ALTER TABLE ${quoteIdentifier(operation.tableName)} ADD ${renderForeignKeyClause(operation.foreignKey)};`,
      ];
    }
    case 'drop_foreign_key': {
      return [
        `ALTER TABLE ${quoteIdentifier(operation.tableName)} DROP CONSTRAINT ${quoteIdentifier(operation.foreignKey.name)};`,
      ];
    }
    default: {
      const exhaustiveCheck: never = operation;
      throw new Error(`Unsupported migration operation kind: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
};

export const renderMigrationSql = (
  plan: MigrationPlan,
  options: RenderMigrationSqlOptions = {},
): string => {
  const includeTransaction = options.includeTransaction ?? true;
  const abortOnBlockedPlan = options.abortOnBlockedPlan ?? true;

  if (abortOnBlockedPlan && plan.blocked) {
    throw new Error('Migration plan is blocked due to destructive/risky changes.');
  }

  const statements = plan.operations.flatMap((operation) => renderOperationSql(operation));

  if (statements.length === 0) {
    return '';
  }

  if (!includeTransaction) {
    return `${statements.join('\n\n')}\n`;
  }

  return `BEGIN;\n\n${statements.join('\n\n')}\n\nCOMMIT;\n`;
};
