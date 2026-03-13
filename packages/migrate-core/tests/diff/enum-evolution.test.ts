import { describe, expect, it } from 'vitest';

import {
  DATABASE_SNAPSHOT_FORMAT_VERSION,
  diffDatabaseSnapshots,
  type DatabaseSnapshot,
} from '../../src/index.js';

const makeSnapshot = (values: string[]): DatabaseSnapshot => ({
  formatVersion: DATABASE_SNAPSHOT_FORMAT_VERSION,
  generatedFromRootDir: '/tmp',
  enums: {
    Status: {
      name: 'Status',
      dbName: 'status',
      values,
      sourcePath: '/tmp/schema.ts',
    },
  },
  tables: {},
});

describe('enum evolution', () => {
  it('supports append-only enum value changes', () => {
    const diff = diffDatabaseSnapshots(
      makeSnapshot(['draft', 'published']),
      makeSnapshot(['draft', 'published', 'archived']),
    );
    expect(diff.changes.enumValuesAppended).toHaveLength(1);
    expect(diff.diagnostics).toEqual([]);
  });

  it('diagnoses reorder as unsupported', () => {
    const diff = diffDatabaseSnapshots(
      makeSnapshot(['draft', 'published']),
      makeSnapshot(['published', 'draft']),
    );
    expect(
      diff.diagnostics.some((diagnostic) => diagnostic.code === 'ENUM_REORDER_UNSUPPORTED'),
    ).toBe(true);
  });

  it('diagnoses value removal as unsupported', () => {
    const diff = diffDatabaseSnapshots(
      makeSnapshot(['draft', 'published']),
      makeSnapshot(['draft']),
    );
    expect(
      diff.diagnostics.some((diagnostic) => diagnostic.code === 'ENUM_VALUE_REMOVED_UNSUPPORTED'),
    ).toBe(true);
  });

  it('diagnoses value rename/replacement as unsupported', () => {
    const diff = diffDatabaseSnapshots(
      makeSnapshot(['draft', 'published']),
      makeSnapshot(['draft', 'public']),
    );
    expect(
      diff.diagnostics.some((diagnostic) => diagnostic.code === 'ENUM_VALUE_RENAMED_UNSUPPORTED'),
    ).toBe(true);
  });
});
