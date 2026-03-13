export interface AppliedMigrationRecord {
  id: string;
  checksum: string;
  appliedAt: string;
  executionMs: number;
}

export interface RecordAppliedMigrationInput {
  id: string;
  checksum: string;
  executionMs: number;
}
