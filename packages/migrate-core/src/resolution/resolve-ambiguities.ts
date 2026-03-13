import { createMigrationDiagnostic } from '../diagnostics/helpers.js';
import type { PromptAdapter } from '../prompts/types.js';
import type { DetectedAmbiguities } from '../ambiguity/types.js';
import type {
  AmbiguityResolutions,
  ResolveAmbiguitiesResult,
  ColumnAmbiguityResolution,
  TableAmbiguityResolution,
} from './types.js';

export interface ResolveAmbiguitiesOptions {
  promptAdapter?: PromptAdapter;
  providedResolutions?: Partial<AmbiguityResolutions>;
  nonInteractive?: boolean;
}

const validateTableResolution = (
  resolution: TableAmbiguityResolution,
  candidateNames: Set<string>,
): string | undefined => {
  if (resolution.decision === 'deleted') {
    return undefined;
  }
  if (!resolution.targetTableName || !candidateNames.has(resolution.targetTableName)) {
    return `Invalid rename target "${resolution.targetTableName ?? '<missing>'}" for table "${resolution.missingTableName}".`;
  }
  return undefined;
};

const validateColumnResolution = (
  resolution: ColumnAmbiguityResolution,
  candidateNames: Set<string>,
): string | undefined => {
  if (resolution.decision === 'deleted') {
    return undefined;
  }
  if (!resolution.targetColumnName || !candidateNames.has(resolution.targetColumnName)) {
    return `Invalid rename target "${resolution.targetColumnName ?? '<missing>'}" for column "${resolution.tableName}.${resolution.missingColumnName}".`;
  }
  return undefined;
};

export const resolveAmbiguities = async (
  ambiguities: DetectedAmbiguities,
  options: ResolveAmbiguitiesOptions = {},
): Promise<ResolveAmbiguitiesResult> => {
  const diagnostics = [] as ResolveAmbiguitiesResult['diagnostics'];
  const tableResolutionsByMissing = new Map<string, TableAmbiguityResolution>();
  const columnResolutionsByMissing = new Map<string, ColumnAmbiguityResolution>();

  for (const resolution of options.providedResolutions?.tables ?? []) {
    tableResolutionsByMissing.set(resolution.missingTableName, resolution);
  }
  for (const resolution of options.providedResolutions?.columns ?? []) {
    columnResolutionsByMissing.set(
      `${resolution.tableName}.${resolution.missingColumnName}`,
      resolution,
    );
  }

  let unresolvedCount = 0;
  const tableResolutions: TableAmbiguityResolution[] = [];
  const usedTargetTables = new Set<string>();

  for (const ambiguity of ambiguities.tables) {
    const provided = tableResolutionsByMissing.get(ambiguity.missingTableName);
    let resolution = provided;

    if (!resolution && options.promptAdapter && !options.nonInteractive) {
      resolution = await options.promptAdapter.chooseTableResolution(ambiguity);
    }

    if (!resolution) {
      unresolvedCount += 1;
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'UNRESOLVED_TABLE_AMBIGUITY',
          severity: 'error',
          message: `Table "${ambiguity.missingTableName}" is ambiguous (deleted vs renamed) and requires explicit resolution.`,
          source: {
            table: ambiguity.missingTableName,
          },
        }),
      );
      continue;
    }

    const candidateNames = new Set(ambiguity.candidates.map((candidate) => candidate.tableName));
    const validationError = validateTableResolution(resolution, candidateNames);
    if (validationError) {
      unresolvedCount += 1;
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'INVALID_TABLE_AMBIGUITY_RESOLUTION',
          severity: 'error',
          message: validationError,
          source: {
            table: ambiguity.missingTableName,
          },
        }),
      );
      continue;
    }

    if (resolution.decision === 'renamed' && resolution.targetTableName) {
      if (usedTargetTables.has(resolution.targetTableName)) {
        unresolvedCount += 1;
        diagnostics.push(
          createMigrationDiagnostic({
            code: 'DUPLICATE_TABLE_RENAME_TARGET',
            severity: 'error',
            message: `Table rename target "${resolution.targetTableName}" was selected more than once.`,
            source: {
              table: ambiguity.missingTableName,
            },
          }),
        );
        continue;
      }
      usedTargetTables.add(resolution.targetTableName);
    }

    tableResolutions.push(resolution);
  }

  const columnResolutions: ColumnAmbiguityResolution[] = [];
  for (const ambiguity of ambiguities.columns) {
    const key = `${ambiguity.tableName}.${ambiguity.missingColumnName}`;
    const provided = columnResolutionsByMissing.get(key);
    let resolution = provided;

    if (!resolution && options.promptAdapter && !options.nonInteractive) {
      resolution = await options.promptAdapter.chooseColumnResolution(ambiguity);
    }

    if (!resolution) {
      unresolvedCount += 1;
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'UNRESOLVED_COLUMN_AMBIGUITY',
          severity: 'error',
          message: `Column "${ambiguity.tableName}.${ambiguity.missingColumnName}" is ambiguous (deleted vs renamed) and requires explicit resolution.`,
          source: {
            table: ambiguity.tableName,
            column: ambiguity.missingColumnName,
          },
        }),
      );
      continue;
    }

    const candidateNames = new Set(ambiguity.candidates.map((candidate) => candidate.columnName));
    const validationError = validateColumnResolution(resolution, candidateNames);
    if (validationError) {
      unresolvedCount += 1;
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'INVALID_COLUMN_AMBIGUITY_RESOLUTION',
          severity: 'error',
          message: validationError,
          source: {
            table: ambiguity.tableName,
            column: ambiguity.missingColumnName,
          },
        }),
      );
      continue;
    }

    columnResolutions.push(resolution);
  }

  return {
    resolutions: {
      tables: tableResolutions.sort((a, b) => a.missingTableName.localeCompare(b.missingTableName)),
      columns: columnResolutions.sort((a, b) => {
        const tableOrder = a.tableName.localeCompare(b.tableName);
        if (tableOrder !== 0) {
          return tableOrder;
        }
        return a.missingColumnName.localeCompare(b.missingColumnName);
      }),
    },
    diagnostics,
    unresolvedCount,
  };
};
