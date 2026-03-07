export type DiagnosticSeverity = 'error' | 'warning';

export interface DiagnosticSource {
  file?: string;
  declaration?: string;
  field?: string;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  source?: DiagnosticSource;
}
