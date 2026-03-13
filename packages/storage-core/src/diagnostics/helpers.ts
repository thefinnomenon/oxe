import type {
  StorageMigrationDiagnostic,
  StorageMigrationDiagnosticSeverity,
  StorageMigrationDiagnosticSource,
} from './types.js';

export const createStorageMigrationDiagnostic = (input: {
  code: string;
  severity: StorageMigrationDiagnosticSeverity;
  message: string;
  source?: StorageMigrationDiagnosticSource;
}): StorageMigrationDiagnostic => ({
  code: input.code,
  severity: input.severity,
  message: input.message,
  source: input.source,
});
