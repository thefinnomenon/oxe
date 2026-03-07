export type MigrationDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface MigrationDiagnosticSource {
  table?: string;
  column?: string;
  enum?: string;
}

export interface MigrationDiagnostic {
  code: string;
  severity: MigrationDiagnosticSeverity;
  message: string;
  source?: MigrationDiagnosticSource;
}
