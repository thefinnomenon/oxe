import type {
  MigrationDiagnostic,
  MigrationDiagnosticSeverity,
  MigrationDiagnosticSource,
} from './types.js';

export interface MigrationDiagnosticInput {
  code: string;
  message: string;
  severity?: MigrationDiagnosticSeverity;
  source?: MigrationDiagnosticSource;
}

export const createMigrationDiagnostic = (
  input: MigrationDiagnosticInput,
): MigrationDiagnostic => ({
  code: input.code,
  severity: input.severity ?? 'warning',
  message: input.message,
  source: input.source,
});
