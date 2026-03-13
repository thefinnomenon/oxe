import type { DatabaseColumnSnapshot, DatabaseTableSnapshot } from '../snapshot/types.js';

export interface AmbiguityCandidateScore {
  score: number;
  nameSimilarity: number;
  shapeSimilarity: number;
}

export interface AmbiguousTableCandidate {
  tableName: string;
  table: DatabaseTableSnapshot;
  score: AmbiguityCandidateScore;
}

export interface AmbiguousTableChange {
  kind: 'table';
  missingTableName: string;
  missingTable: DatabaseTableSnapshot;
  candidates: AmbiguousTableCandidate[];
}

export interface AmbiguousColumnCandidate {
  columnName: string;
  column: DatabaseColumnSnapshot;
  score: AmbiguityCandidateScore;
}

export interface AmbiguousColumnChange {
  kind: 'column';
  tableName: string;
  missingColumnName: string;
  missingColumn: DatabaseColumnSnapshot;
  candidates: AmbiguousColumnCandidate[];
}

export interface DetectedAmbiguities {
  tables: AmbiguousTableChange[];
  columns: AmbiguousColumnChange[];
}
