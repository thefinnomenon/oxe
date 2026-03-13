import { renderMigrationSql } from '../sql/render-migration-sql.js';
import type { MigrationPlan } from './types.js';

export interface MigrationPreview {
  blocked: boolean;
  hasChanges: boolean;
  operationCount: number;
  operationsByKind: Record<string, number>;
  diagnostics: MigrationPlan['diagnostics'];
  sql: string;
}

export interface CreateMigrationPreviewOptions {
  includeSql?: boolean;
}

export const createMigrationPreview = (
  plan: MigrationPlan,
  options: CreateMigrationPreviewOptions = {},
): MigrationPreview => {
  const includeSql = options.includeSql ?? true;
  const operationsByKind = Object.fromEntries(
    [
      ...plan.operations
        .reduce((map, operation) => {
          map.set(operation.kind, (map.get(operation.kind) ?? 0) + 1);
          return map;
        }, new Map<string, number>())
        .entries(),
    ].sort(([a], [b]) => a.localeCompare(b)),
  );

  return {
    blocked: plan.blocked,
    hasChanges: plan.operations.length > 0,
    operationCount: plan.operations.length,
    operationsByKind,
    diagnostics: [...plan.diagnostics],
    sql: includeSql ? renderMigrationSql(plan, { abortOnBlockedPlan: false }) : '',
  };
};
