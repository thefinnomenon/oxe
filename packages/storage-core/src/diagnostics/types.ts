export type StorageMigrationDiagnosticSeverity = 'warning' | 'error';

export interface StorageMigrationDiagnosticSource {
  bucket?: string;
  filePath?: string;
}

export interface StorageMigrationDiagnostic {
  code: string;
  severity: StorageMigrationDiagnosticSeverity;
  message: string;
  source?: StorageMigrationDiagnosticSource;
}
