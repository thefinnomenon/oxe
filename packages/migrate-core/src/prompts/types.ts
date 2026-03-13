import type { AmbiguousColumnChange, AmbiguousTableChange } from '../ambiguity/types.js';
import type { ColumnAmbiguityResolution, TableAmbiguityResolution } from '../resolution/types.js';

export interface PromptAdapter {
  chooseTableResolution(change: AmbiguousTableChange): Promise<TableAmbiguityResolution>;
  chooseColumnResolution(change: AmbiguousColumnChange): Promise<ColumnAmbiguityResolution>;
  confirmDestructive?(): Promise<boolean>;
}
