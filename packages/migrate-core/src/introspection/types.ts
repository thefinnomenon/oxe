import type { PostgresConnectionOptions } from '../apply/types.js';

export interface IntrospectDatabaseSnapshotOptions extends PostgresConnectionOptions {
  schema?: string;
}
