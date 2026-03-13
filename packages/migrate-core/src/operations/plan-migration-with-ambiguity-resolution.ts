import { createMigrationDiagnostic } from '../diagnostics/helpers.js';
import type { DatabaseSnapshotDiff } from '../diff/types.js';
import {
  detectAmbiguousChanges,
  detectColumnAmbiguitiesForTablePair,
} from '../ambiguity/detect-ambiguous-changes.js';
import type { DetectedAmbiguities } from '../ambiguity/types.js';
import type { PromptAdapter } from '../prompts/types.js';
import {
  resolveAmbiguities,
  type AmbiguityResolutions,
  type ResolveAmbiguitiesResult,
} from '../resolution/index.js';
import { collectRenameHints } from './collect-rename-hints.js';
import { generateMigrationPlan } from './generate-migration-plan.js';
import type { MigrationPlan, MigrationRenameHints } from './types.js';

export interface PlanMigrationWithAmbiguityResolutionOptions {
  allowDestructive?: boolean;
  nonInteractive?: boolean;
  promptAdapter?: PromptAdapter;
  providedResolutions?: Partial<AmbiguityResolutions>;
  renameHints?: MigrationRenameHints;
}

export interface PlanMigrationWithAmbiguityResolutionResult {
  ambiguities: DetectedAmbiguities;
  resolution: ResolveAmbiguitiesResult;
  plan: MigrationPlan;
}

export const planMigrationWithAmbiguityResolution = async (
  diff: DatabaseSnapshotDiff,
  options: PlanMigrationWithAmbiguityResolutionOptions = {},
): Promise<PlanMigrationWithAmbiguityResolutionResult> => {
  const ambiguities = detectAmbiguousChanges(diff);
  const hintedRenameEntries = collectRenameHints(diff, options.renameHints);
  const hintedResolutions: Partial<AmbiguityResolutions> = {
    tables: hintedRenameEntries.tableRenames.map((entry) => ({
      missingTableName: entry.fromTableName,
      decision: 'renamed',
      targetTableName: entry.toTableName,
    })),
    columns: hintedRenameEntries.columnRenames.map((entry) => ({
      tableName: entry.tableName,
      missingColumnName: entry.fromColumnName,
      decision: 'renamed',
      targetColumnName: entry.toColumnName,
    })),
  };

  const mergedProvidedResolutions: Partial<AmbiguityResolutions> = {
    tables: [...(hintedResolutions.tables ?? []), ...(options.providedResolutions?.tables ?? [])],
    columns: [
      ...(hintedResolutions.columns ?? []),
      ...(options.providedResolutions?.columns ?? []),
    ],
  };

  const resolution = await resolveAmbiguities(ambiguities, {
    promptAdapter: options.promptAdapter,
    providedResolutions: mergedProvidedResolutions,
    nonInteractive: options.nonInteractive,
  });

  const unresolved = resolution.unresolvedCount > 0;
  if (unresolved) {
    return {
      ambiguities,
      resolution,
      plan: {
        operations: [],
        diagnostics: [
          ...hintedRenameEntries.diagnostics,
          ...resolution.diagnostics,
          createMigrationDiagnostic({
            code: 'PLAN_BLOCKED_UNRESOLVED_AMBIGUITY',
            severity: 'error',
            message:
              'Migration plan contains unresolved rename-vs-delete ambiguities. Resolve them interactively or provide explicit resolutions.',
          }),
        ],
        blocked: true,
      },
    };
  }

  const additionalColumnAmbiguities = resolution.resolutions.tables
    .filter((entry) => entry.decision === 'renamed' && entry.targetTableName)
    .flatMap((entry) => {
      const tableAmbiguity = ambiguities.tables.find(
        (candidate) => candidate.missingTableName === entry.missingTableName,
      );
      if (!tableAmbiguity || !entry.targetTableName) {
        return [];
      }
      const selectedCandidate = tableAmbiguity.candidates.find(
        (candidate) => candidate.tableName === entry.targetTableName,
      );
      if (!selectedCandidate) {
        return [];
      }
      return detectColumnAmbiguitiesForTablePair(
        entry.targetTableName,
        tableAmbiguity.missingTable,
        selectedCandidate.table,
      );
    });

  let columnResolution: ResolveAmbiguitiesResult = {
    resolutions: {
      tables: [] as AmbiguityResolutions['tables'],
      columns: [] as AmbiguityResolutions['columns'],
    },
    diagnostics: [],
    unresolvedCount: 0,
  };
  if (additionalColumnAmbiguities.length > 0) {
    columnResolution = await resolveAmbiguities(
      {
        tables: [],
        columns: additionalColumnAmbiguities,
      },
      {
        promptAdapter: options.promptAdapter,
        providedResolutions: mergedProvidedResolutions,
        nonInteractive: options.nonInteractive,
      },
    );

    if (columnResolution.unresolvedCount > 0) {
      return {
        ambiguities: {
          ...ambiguities,
          columns: [...ambiguities.columns, ...additionalColumnAmbiguities],
        },
        resolution: {
          resolutions: {
            tables: resolution.resolutions.tables,
            columns: [...resolution.resolutions.columns, ...columnResolution.resolutions.columns],
          },
          diagnostics: [...resolution.diagnostics, ...columnResolution.diagnostics],
          unresolvedCount: resolution.unresolvedCount + columnResolution.unresolvedCount,
        },
        plan: {
          operations: [],
          diagnostics: [
            ...hintedRenameEntries.diagnostics,
            ...resolution.diagnostics,
            ...columnResolution.diagnostics,
            createMigrationDiagnostic({
              code: 'PLAN_BLOCKED_UNRESOLVED_AMBIGUITY',
              severity: 'error',
              message:
                'Migration plan contains unresolved rename-vs-delete ambiguities. Resolve them interactively or provide explicit resolutions.',
            }),
          ],
          blocked: true,
        },
      };
    }
  }

  const combinedResolutions: AmbiguityResolutions = {
    tables: [...resolution.resolutions.tables],
    columns: [
      ...resolution.resolutions.columns,
      ...columnResolution.resolutions.columns.filter(
        (entry) =>
          !resolution.resolutions.columns.some(
            (existing) =>
              existing.tableName === entry.tableName &&
              existing.missingColumnName === entry.missingColumnName,
          ),
      ),
    ],
  };

  const renameHints = {
    tableRenames: combinedResolutions.tables
      .filter((entry) => entry.decision === 'renamed' && entry.targetTableName)
      .map((entry) => ({
        fromTableName: entry.missingTableName,
        toTableName: entry.targetTableName as string,
      })),
    columnRenames: combinedResolutions.columns
      .filter((entry) => entry.decision === 'renamed' && entry.targetColumnName)
      .map((entry) => ({
        tableName: entry.tableName,
        fromColumnName: entry.missingColumnName,
        toColumnName: entry.targetColumnName as string,
      })),
  };

  const plan = generateMigrationPlan(diff, {
    allowDestructive: options.allowDestructive,
    renameHints: {
      tableRenames: [
        ...(options.renameHints?.tableRenames ?? []),
        ...(renameHints.tableRenames ?? []),
      ],
      columnRenames: [
        ...(options.renameHints?.columnRenames ?? []),
        ...(renameHints.columnRenames ?? []),
      ],
    },
  });

  return {
    ambiguities,
    resolution: {
      resolutions: combinedResolutions,
      diagnostics: [...resolution.diagnostics, ...columnResolution.diagnostics],
      unresolvedCount: 0,
    },
    plan: {
      ...plan,
      diagnostics: [
        ...hintedRenameEntries.diagnostics,
        ...resolution.diagnostics,
        ...columnResolution.diagnostics,
        ...plan.diagnostics,
      ],
    },
  };
};
