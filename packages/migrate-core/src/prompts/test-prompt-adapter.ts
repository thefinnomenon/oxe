import type { AmbiguousColumnChange, AmbiguousTableChange } from '../ambiguity/types.js';
import type { ColumnAmbiguityResolution, TableAmbiguityResolution } from '../resolution/types.js';
import type { PromptAdapter } from './types.js';

export interface TestPromptAdapterInput {
  tableResolutions?: TableAmbiguityResolution[];
  columnResolutions?: ColumnAmbiguityResolution[];
  confirmDestructive?: boolean;
}

export class TestPromptAdapter implements PromptAdapter {
  private readonly tableResolutions: TableAmbiguityResolution[];
  private readonly columnResolutions: ColumnAmbiguityResolution[];
  private readonly destructiveConfirmation: boolean;

  constructor(input: TestPromptAdapterInput = {}) {
    this.tableResolutions = [...(input.tableResolutions ?? [])];
    this.columnResolutions = [...(input.columnResolutions ?? [])];
    this.destructiveConfirmation = input.confirmDestructive ?? false;
  }

  public async chooseTableResolution(
    change: AmbiguousTableChange,
  ): Promise<TableAmbiguityResolution> {
    const resolved = this.tableResolutions.find(
      (entry) => entry.missingTableName === change.missingTableName,
    );
    if (!resolved) {
      return {
        missingTableName: change.missingTableName,
        decision: 'deleted',
      };
    }
    return resolved;
  }

  public async chooseColumnResolution(
    change: AmbiguousColumnChange,
  ): Promise<ColumnAmbiguityResolution> {
    const resolved = this.columnResolutions.find(
      (entry) =>
        entry.tableName === change.tableName &&
        entry.missingColumnName === change.missingColumnName,
    );
    if (!resolved) {
      return {
        tableName: change.tableName,
        missingColumnName: change.missingColumnName,
        decision: 'deleted',
      };
    }
    return resolved;
  }

  public async confirmDestructive(): Promise<boolean> {
    return this.destructiveConfirmation;
  }
}
