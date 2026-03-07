import type { Diagnostic } from '../diagnostics/types.js';

export interface SchemaValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}
