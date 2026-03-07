import type { Diagnostic, DiagnosticSeverity, DiagnosticSource } from './types.js';

export interface DiagnosticInput {
  code: string;
  message: string;
  severity?: DiagnosticSeverity;
  source?: DiagnosticSource;
}

export const createDiagnostic = (input: DiagnosticInput): Diagnostic => ({
  code: input.code,
  severity: input.severity ?? 'error',
  message: input.message,
  source: input.source,
});

export const formatDiagnostic = (diagnostic: Diagnostic): string => {
  const sourceParts = [
    diagnostic.source?.file,
    diagnostic.source?.declaration,
    diagnostic.source?.field,
  ].filter((value): value is string => Boolean(value));

  const sourceText = sourceParts.length > 0 ? ` (${sourceParts.join(' > ')})` : '';
  return `[${diagnostic.severity.toUpperCase()}][${diagnostic.code}] ${diagnostic.message}${sourceText}`;
};
