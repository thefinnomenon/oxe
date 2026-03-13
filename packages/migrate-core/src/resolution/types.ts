import type { MigrationDiagnostic } from '../diagnostics/types.js';

export interface TableAmbiguityResolution {
  missingTableName: string;
  decision: 'deleted' | 'renamed';
  targetTableName?: string;
}

export interface ColumnAmbiguityResolution {
  tableName: string;
  missingColumnName: string;
  decision: 'deleted' | 'renamed';
  targetColumnName?: string;
}

export interface AmbiguityResolutions {
  tables: TableAmbiguityResolution[];
  columns: ColumnAmbiguityResolution[];
}

export interface ResolveAmbiguitiesResult {
  resolutions: AmbiguityResolutions;
  diagnostics: MigrationDiagnostic[];
  unresolvedCount: number;
}
