import { createInterface } from 'node:readline/promises';

import type { AmbiguousColumnChange, AmbiguousTableChange } from '../ambiguity/types.js';
import type { ColumnAmbiguityResolution, TableAmbiguityResolution } from '../resolution/types.js';
import type { PromptAdapter } from './types.js';

const toCompatibilityLabel = (shapeSimilarity: number): string =>
  shapeSimilarity >= 0.999 ? ' (compatible shape)' : '';

const parseSelection = (input: string): number | undefined => {
  const value = Number(input.trim());
  if (!Number.isInteger(value)) {
    return undefined;
  }
  return value;
};

export class InteractivePromptAdapter implements PromptAdapter {
  public async chooseTableResolution(
    change: AmbiguousTableChange,
  ): Promise<TableAmbiguityResolution> {
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log(`\nTable "${change.missingTableName}" no longer exists.`);
      console.log('Choose a replacement table, or select 0 if it was deleted:');
      console.log('  0) Deleted');
      for (let index = 0; index < change.candidates.length; index += 1) {
        const candidate = change.candidates[index];
        console.log(
          `  ${index + 1}) ${candidate.tableName}${toCompatibilityLabel(candidate.score.shapeSimilarity)}`,
        );
      }

      while (true) {
        const answer = await reader.question(
          `Selection for "${change.missingTableName}" [0-${change.candidates.length}]: `,
        );
        const selected = parseSelection(answer);
        if (selected === undefined || selected < 0 || selected > change.candidates.length) {
          console.log('Invalid selection. Enter a number from the list.');
          continue;
        }

        if (selected === 0) {
          return {
            missingTableName: change.missingTableName,
            decision: 'deleted',
          };
        }

        const candidate = change.candidates[selected - 1];
        if (candidate.score.shapeSimilarity < 0.999) {
          const confirm = await reader.question(
            `Tables are not shape-compatible. Continue with rename "${change.missingTableName}" -> "${candidate.tableName}" anyway? [y/N] `,
          );
          const accepted = ['y', 'yes'].includes(confirm.trim().toLowerCase());
          if (!accepted) {
            return {
              missingTableName: change.missingTableName,
              decision: 'deleted',
            };
          }
        }

        return {
          missingTableName: change.missingTableName,
          decision: 'renamed',
          targetTableName: candidate.tableName,
        };
      }
    } finally {
      reader.close();
    }
  }

  public async chooseColumnResolution(
    change: AmbiguousColumnChange,
  ): Promise<ColumnAmbiguityResolution> {
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log(`\nColumn "${change.tableName}.${change.missingColumnName}" no longer exists.`);
      console.log('Choose a replacement column, or select 0 if it was deleted:');
      console.log('  0) Deleted');
      for (let index = 0; index < change.candidates.length; index += 1) {
        const candidate = change.candidates[index];
        console.log(
          `  ${index + 1}) ${candidate.columnName}${toCompatibilityLabel(candidate.score.shapeSimilarity)}`,
        );
      }

      while (true) {
        const answer = await reader.question(
          `Selection for "${change.tableName}.${change.missingColumnName}" [0-${change.candidates.length}]: `,
        );
        const selected = parseSelection(answer);
        if (selected === undefined || selected < 0 || selected > change.candidates.length) {
          console.log('Invalid selection. Enter a number from the list.');
          continue;
        }

        if (selected === 0) {
          return {
            tableName: change.tableName,
            missingColumnName: change.missingColumnName,
            decision: 'deleted',
          };
        }

        const candidate = change.candidates[selected - 1];
        if (candidate.score.shapeSimilarity < 0.999) {
          const confirm = await reader.question(
            `Columns are not shape-compatible. Continue with rename "${change.tableName}.${change.missingColumnName}" -> "${change.tableName}.${candidate.columnName}" anyway? [y/N] `,
          );
          const accepted = ['y', 'yes'].includes(confirm.trim().toLowerCase());
          if (!accepted) {
            return {
              tableName: change.tableName,
              missingColumnName: change.missingColumnName,
              decision: 'deleted',
            };
          }
        }

        return {
          tableName: change.tableName,
          missingColumnName: change.missingColumnName,
          decision: 'renamed',
          targetColumnName: candidate.columnName,
        };
      }
    } finally {
      reader.close();
    }
  }

  public async confirmDestructive(): Promise<boolean> {
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const answer = await reader.question(
        'This migration includes destructive/risky changes. Continue and generate SQL anyway? [y/N] ',
      );
      return ['y', 'yes'].includes(answer.trim().toLowerCase());
    } finally {
      reader.close();
    }
  }
}
