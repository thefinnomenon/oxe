import type { MigrationOperation } from './types.js';

const OPERATION_PRIORITY: Record<MigrationOperation['kind'], number> = {
  create_enum: 10,
  append_enum_value: 15,
  create_table: 20,
  rename_table: 25,
  add_column: 30,
  rename_column: 35,
  alter_column_type: 40,
  alter_column_nullability: 41,
  alter_column_default: 42,
  add_unique: 50,
  add_index: 51,
  add_foreign_key: 60,
  drop_foreign_key: 70,
  drop_index: 80,
  drop_unique: 81,
  drop_column: 90,
  drop_table: 100,
  drop_enum: 110,
};

const operationIdentity = (operation: MigrationOperation): string => {
  switch (operation.kind) {
    case 'create_enum':
    case 'drop_enum':
      return operation.enum.dbName;
    case 'append_enum_value':
      return `${operation.enumDbName}.${operation.value}`;
    case 'create_table':
    case 'drop_table':
      return operation.table.dbName;
    case 'rename_table':
      return `${operation.fromDbName}->${operation.toDbName}`;
    case 'add_column':
    case 'drop_column':
      return `${operation.tableDbName}.${operation.column.name}`;
    case 'rename_column':
      return `${operation.tableDbName}.${operation.fromColumnName}->${operation.toColumnName}`;
    case 'alter_column_type':
    case 'alter_column_nullability':
    case 'alter_column_default':
      return `${operation.tableDbName}.${operation.columnName}`;
    case 'add_index':
    case 'drop_index':
      return operation.index.name;
    case 'add_unique':
    case 'drop_unique':
      return operation.unique.name;
    case 'add_foreign_key':
    case 'drop_foreign_key':
      return operation.foreignKey.name;
    default: {
      const exhaustive: never = operation;
      return JSON.stringify(exhaustive);
    }
  }
};

const foreignKeyKey = (operation: MigrationOperation): string | undefined => {
  if (operation.kind === 'add_foreign_key' || operation.kind === 'drop_foreign_key') {
    return `${operation.tableDbName}.${operation.foreignKey.name}`;
  }
  return undefined;
};

export const orderMigrationOperations = (
  operations: MigrationOperation[],
): MigrationOperation[] => {
  const operationsWithIndices = operations.map((operation, index) => ({ operation, index }));
  const foreignKeyKinds = new Map<string, Set<'add' | 'drop'>>();
  for (const entry of operations) {
    const key = foreignKeyKey(entry);
    if (!key) {
      continue;
    }
    const current = foreignKeyKinds.get(key) ?? new Set<'add' | 'drop'>();
    if (entry.kind === 'add_foreign_key') {
      current.add('add');
    } else {
      current.add('drop');
    }
    foreignKeyKinds.set(key, current);
  }

  const priorityFor = (operation: MigrationOperation): number => {
    if (operation.kind === 'drop_foreign_key') {
      const key = foreignKeyKey(operation);
      if (key && foreignKeyKinds.get(key)?.has('add')) {
        return 59;
      }
    }
    return OPERATION_PRIORITY[operation.kind];
  };

  return [...operationsWithIndices]
    .sort((left, right) => {
      const leftPriority = priorityFor(left.operation);
      const rightPriority = priorityFor(right.operation);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      const leftKey = operationIdentity(left.operation);
      const rightKey = operationIdentity(right.operation);
      const keyOrder = leftKey.localeCompare(rightKey);
      if (keyOrder !== 0) {
        return keyOrder;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.operation);
};
