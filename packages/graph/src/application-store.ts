import { createHash } from 'node:crypto';
import type { PathLike } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { indexApplicationGraph } from './application-index.js';
import {
  mutateApplicationGraph,
  validateApplicationMutationBatch,
  type ApplicationMutationBatchV1,
  type ApplicationMutationOperationV1,
  type ApplicationMutationResultV1,
} from './application-mutate.js';
import {
  canonicalizeApplicationGraph,
  serializeApplicationGraph,
  serializeCompactApplicationJson,
} from './application-serialize.js';
import type { ApplicationGraphV1 } from './application-types.js';
import {
  ApplicationGraphValidationError,
  loadApplicationGraph,
  validateApplicationGraph,
} from './application-validate.js';

const STORE_SCHEMA_VERSION = 2;

export type ApplicationRevisionReasonV1 = 'initialize' | 'mutation' | 'undo';

export interface ApplicationRevisionMetadataV1 {
  readonly appId: string;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly mutationCount: number;
  readonly nodeCount: number;
  readonly parentRevision: number | null;
  readonly reason: ApplicationRevisionReasonV1;
  readonly referenceCount: number;
  readonly revision: number;
}

export interface ApplicationStoredReferenceV1 {
  readonly label: string;
  readonly path: string;
  readonly sourceId: string;
  readonly targetId: string;
}

export interface ApplicationActivePublicationV1 {
  readonly activatedAt: string;
  readonly appId: string;
  readonly revision: number;
}

export interface ApplicationUndoOperationV1 {
  readonly op: 'revision.undo';
  readonly targetRevision: number;
}

export interface ApplicationMutationLogEntryV1 {
  readonly index: number;
  readonly operation: ApplicationMutationOperationV1 | ApplicationUndoOperationV1;
  readonly revision: number;
}

type MutationFailure = Extract<ApplicationMutationResultV1, { readonly ok: false }>;
type MutationSuccess = Extract<ApplicationMutationResultV1, { readonly ok: true }>;

export type ApplicationRevisionCommitResultV1 =
  | MutationFailure
  | (MutationSuccess & {
      readonly contentHash: string;
      readonly parentRevision: number;
    });

export interface ApplicationRevisionStoreOptions {
  /** Defaults to a five-second SQLite busy timeout. */
  readonly timeoutMs?: number;
  /** Injectable deterministic timestamp source for tests and reproducible imports. */
  readonly timestamp?: () => string;
}

export type ApplicationRevisionStoreErrorCode = 'OXE3301' | 'OXE3302' | 'OXE3303' | 'OXE3304';

export class ApplicationRevisionStoreError extends Error {
  public constructor(
    public readonly code: ApplicationRevisionStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationRevisionStoreError';
  }
}

interface PersistedRevision {
  readonly metadata: ApplicationRevisionMetadataV1;
  readonly graph: ApplicationGraphV1;
}

const schemaSql = `
  CREATE TABLE IF NOT EXISTS oxe_store_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS application_revisions (
    app_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    parent_revision INTEGER,
    content_hash TEXT NOT NULL,
    graph_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('initialize', 'mutation', 'undo')),
    node_count INTEGER NOT NULL CHECK (node_count >= 0),
    reference_count INTEGER NOT NULL CHECK (reference_count >= 0),
    mutation_count INTEGER NOT NULL CHECK (mutation_count >= 0),
    PRIMARY KEY (app_id, revision),
    FOREIGN KEY (app_id, parent_revision)
      REFERENCES application_revisions (app_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS application_nodes (
    app_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    semantic_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    graph_path TEXT NOT NULL,
    body_json TEXT NOT NULL,
    PRIMARY KEY (app_id, revision, semantic_id),
    FOREIGN KEY (app_id, revision)
      REFERENCES application_revisions (app_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS application_references (
    app_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    label TEXT NOT NULL,
    graph_path TEXT NOT NULL,
    PRIMARY KEY (app_id, revision, source_id, target_id, graph_path),
    FOREIGN KEY (app_id, revision, source_id)
      REFERENCES application_nodes (app_id, revision, semantic_id),
    FOREIGN KEY (app_id, revision, target_id)
      REFERENCES application_nodes (app_id, revision, semantic_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS application_references_outgoing
    ON application_references (app_id, revision, source_id);
  CREATE INDEX IF NOT EXISTS application_references_incoming
    ON application_references (app_id, revision, target_id);

  CREATE TABLE IF NOT EXISTS application_mutation_log (
    app_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    operation_index INTEGER NOT NULL CHECK (operation_index >= 0),
    operation_json TEXT NOT NULL,
    PRIMARY KEY (app_id, revision, operation_index),
    FOREIGN KEY (app_id, revision)
      REFERENCES application_revisions (app_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS application_heads (
    app_id TEXT PRIMARY KEY,
    current_revision INTEGER NOT NULL,
    current_hash TEXT NOT NULL,
    FOREIGN KEY (app_id, current_revision)
      REFERENCES application_revisions (app_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS application_publications (
    app_id TEXT PRIMARY KEY,
    active_revision INTEGER NOT NULL,
    activated_at TEXT NOT NULL,
    FOREIGN KEY (app_id, active_revision)
      REFERENCES application_revisions (app_id, revision)
  ) STRICT;

  CREATE TRIGGER IF NOT EXISTS application_revisions_no_update
    BEFORE UPDATE ON application_revisions BEGIN
      SELECT RAISE(ABORT, 'application revisions are immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS application_revisions_no_delete
    BEFORE DELETE ON application_revisions BEGIN
      SELECT RAISE(ABORT, 'application revisions are immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS application_nodes_no_update
    BEFORE UPDATE ON application_nodes BEGIN
      SELECT RAISE(ABORT, 'application nodes are immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS application_nodes_no_delete
    BEFORE DELETE ON application_nodes BEGIN
      SELECT RAISE(ABORT, 'application nodes are immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS application_references_no_update
    BEFORE UPDATE ON application_references BEGIN
      SELECT RAISE(ABORT, 'application references are immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS application_references_no_delete
    BEFORE DELETE ON application_references BEGIN
      SELECT RAISE(ABORT, 'application references are immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS application_mutation_log_no_update
    BEFORE UPDATE ON application_mutation_log BEGIN
      SELECT RAISE(ABORT, 'application mutation log is immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS application_mutation_log_no_delete
    BEFORE DELETE ON application_mutation_log BEGIN
      SELECT RAISE(ABORT, 'application mutation log is immutable');
    END;
`;

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== 'string')
    throw new ApplicationRevisionStoreError('OXE3302', `Stored ${label} must be text.`);
  return value;
};

const requireNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new ApplicationRevisionStoreError('OXE3302', `Stored ${label} must be an integer.`);
  return value;
};

const optionalNumber = (value: unknown, label: string): number | null =>
  value === null ? null : requireNumber(value, label);

const requireReason = (value: unknown): ApplicationRevisionReasonV1 => {
  if (value === 'initialize' || value === 'mutation' || value === 'undo') return value;
  throw new ApplicationRevisionStoreError('OXE3302', 'Stored revision reason is invalid.');
};

const revisionMetadataFromRow = (row: Record<string, unknown>): ApplicationRevisionMetadataV1 => ({
  appId: requireString(row.app_id, 'application id'),
  contentHash: requireString(row.content_hash, 'content hash'),
  createdAt: requireString(row.created_at, 'creation time'),
  mutationCount: requireNumber(row.mutation_count, 'mutation count'),
  nodeCount: requireNumber(row.node_count, 'node count'),
  parentRevision: optionalNumber(row.parent_revision, 'parent revision'),
  reason: requireReason(row.reason),
  referenceCount: requireNumber(row.reference_count, 'reference count'),
  revision: requireNumber(row.revision, 'revision'),
});

const contentHash = (graph: ApplicationGraphV1): string =>
  `sha256:${createHash('sha256')
    .update(serializeApplicationGraph({ ...graph, revision: 0 }))
    .digest('hex')}`;

const mutationFailure = (
  graph: ApplicationGraphV1,
  code: 'OXE3201' | 'OXE3202' | 'OXE3203',
  path: string,
  message: string,
): MutationFailure => ({
  diagnostics: [{ code, message, path }],
  graph,
  ok: false,
  revision: graph.revision,
});

export class ApplicationRevisionStore implements Disposable {
  readonly #database: DatabaseSync;
  readonly #timestamp: () => string;

  public constructor(path: PathLike, options: ApplicationRevisionStoreOptions = {}) {
    this.#database = new DatabaseSync(path, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: options.timeoutMs ?? 5_000,
    });
    this.#timestamp = options.timestamp ?? (() => new Date().toISOString());
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
    this.#database.prepare('PRAGMA journal_mode = WAL').get();
    this.#database.exec(schemaSql);
    this.#database
      .prepare(
        `INSERT INTO oxe_store_metadata (key, value) VALUES ('schema_version', ?)
         ON CONFLICT (key) DO NOTHING`,
      )
      .run(String(STORE_SCHEMA_VERSION));
    const schema = this.#database
      .prepare(`SELECT value FROM oxe_store_metadata WHERE key = 'schema_version'`)
      .get();
    const storedSchemaVersion = schema
      ? requireString(schema.value, 'schema version')
      : String(STORE_SCHEMA_VERSION);
    if (storedSchemaVersion === '1')
      this.#database
        .prepare(`UPDATE oxe_store_metadata SET value = ? WHERE key = 'schema_version'`)
        .run(String(STORE_SCHEMA_VERSION));
    else if (storedSchemaVersion !== String(STORE_SCHEMA_VERSION))
      throw new ApplicationRevisionStoreError(
        'OXE3301',
        `Unsupported application revision store schema; expected ${STORE_SCHEMA_VERSION}.`,
      );
  }

  public get journalMode(): string {
    const row = this.#database.prepare('PRAGMA journal_mode').get();
    return requireString(row?.journal_mode, 'journal mode');
  }

  public initialize(graph: ApplicationGraphV1): ApplicationRevisionMetadataV1 {
    const diagnostics = validateApplicationGraph(graph);
    if (diagnostics.length > 0) throw new ApplicationGraphValidationError(diagnostics);
    return this.#transaction(() => {
      const existing = this.#headRow(graph.app.id);
      if (existing) {
        const persisted = this.#loadRevision(
          graph.app.id,
          requireNumber(existing.current_revision, 'head revision'),
        );
        if (
          persisted.graph.revision === graph.revision &&
          persisted.metadata.contentHash === contentHash(graph)
        ) {
          this.#initializePublication(graph.app.id, graph.revision);
          return persisted.metadata;
        }
        throw new ApplicationRevisionStoreError(
          'OXE3303',
          `Application "${graph.app.id}" is already initialized at r${persisted.graph.revision}.`,
        );
      }
      const metadata = this.#persistRevision(graph, null, 'initialize', []);
      this.#database
        .prepare(
          `INSERT INTO application_heads (app_id, current_revision, current_hash)
           VALUES (?, ?, ?)`,
        )
        .run(graph.app.id, graph.revision, metadata.contentHash);
      this.#initializePublication(graph.app.id, graph.revision);
      return metadata;
    });
  }

  public activePublication(appId: string): ApplicationActivePublicationV1 | undefined {
    const row = this.#database
      .prepare(
        `SELECT app_id, active_revision, activated_at
         FROM application_publications WHERE app_id = ?`,
      )
      .get(appId);
    return row
      ? {
          activatedAt: requireString(row.activated_at, 'publication activation time'),
          appId: requireString(row.app_id, 'publication application id'),
          revision: requireNumber(row.active_revision, 'active publication revision'),
        }
      : undefined;
  }

  public activate(appId: string, revision: number): ApplicationActivePublicationV1 {
    return this.#transaction(() => {
      this.#loadRevision(appId, revision);
      const activatedAt = this.#timestamp();
      this.#database
        .prepare(
          `INSERT INTO application_publications (app_id, active_revision, activated_at)
           VALUES (?, ?, ?)
           ON CONFLICT (app_id) DO UPDATE SET
             active_revision = excluded.active_revision,
             activated_at = excluded.activated_at`,
        )
        .run(appId, revision, activatedAt);
      return { activatedAt, appId, revision };
    });
  }

  public current(appId: string): ApplicationGraphV1 | undefined {
    const head = this.#headRow(appId);
    return head ? this.#revisionAtHead(appId, head).graph : undefined;
  }

  public load(appId: string, revision: number): ApplicationGraphV1 | undefined {
    return this.#revisionRow(appId, revision)?.graph;
  }

  public metadata(appId: string, revision: number): ApplicationRevisionMetadataV1 | undefined {
    return this.#revisionRow(appId, revision)?.metadata;
  }

  public history(appId: string): readonly ApplicationRevisionMetadataV1[] {
    return this.#database
      .prepare(
        `SELECT app_id, revision, parent_revision, content_hash, created_at, reason,
                node_count, reference_count, mutation_count
         FROM application_revisions WHERE app_id = ? ORDER BY revision`,
      )
      .all(appId)
      .map(revisionMetadataFromRow);
  }

  public commit(
    appId: string,
    batch: ApplicationMutationBatchV1,
  ): ApplicationRevisionCommitResultV1 {
    return this.#transaction(() => {
      const head = this.#requiredHead(appId);
      const current = this.#revisionAtHead(appId, head).graph;
      const mutation = mutateApplicationGraph(current, batch);
      if (!mutation.ok) return mutation;
      const graph = canonicalizeApplicationGraph(mutation.graph);
      const metadata = this.#persistRevision(graph, current.revision, 'mutation', batch.ops);
      this.#compareAndSetHead(appId, batch.base, metadata);
      return {
        ...mutation,
        contentHash: metadata.contentHash,
        graph,
        parentRevision: current.revision,
      };
    });
  }

  public undo(
    appId: string,
    baseRevision: number,
    targetRevision: number,
  ): ApplicationRevisionCommitResultV1 {
    return this.#transaction(() => {
      const head = this.#requiredHead(appId);
      const current = this.#revisionAtHead(appId, head).graph;
      if (baseRevision !== current.revision)
        return mutationFailure(
          current,
          'OXE3201',
          '$.base',
          `Undo base r${baseRevision} does not match current revision r${current.revision}.`,
        );
      if (targetRevision === current.revision)
        return mutationFailure(
          current,
          'OXE3203',
          '$.targetRevision',
          'Undo target must differ from the current revision.',
        );
      const target = this.#revisionRow(appId, targetRevision);
      if (!target)
        return mutationFailure(
          current,
          'OXE3202',
          '$.targetRevision',
          `Undo target r${targetRevision} does not exist for "${appId}".`,
        );
      const revision = current.revision + 1;
      const graph = { ...target.graph, revision };
      const diagnostics = validateApplicationGraph(graph);
      if (diagnostics.length > 0)
        throw new ApplicationRevisionStoreError(
          'OXE3302',
          `Stored undo target r${targetRevision} is invalid: ${diagnostics[0]?.message ?? 'unknown graph error'}`,
        );
      const metadata = this.#persistRevision(graph, current.revision, 'undo', [
        { op: 'revision.undo', targetRevision },
      ]);
      this.#compareAndSetHead(appId, baseRevision, metadata);
      return {
        baseRevision,
        changes: [],
        contentHash: metadata.contentHash,
        graph,
        ok: true,
        parentRevision: current.revision,
        revision,
        summary: `r${revision} committed\n\n~ restored r${targetRevision}\n\nchecked graph types persistence\n`,
      };
    });
  }

  public mutationLog(appId: string, revision: number): readonly ApplicationMutationLogEntryV1[] {
    return this.#database
      .prepare(
        `SELECT revision, operation_index, operation_json
         FROM application_mutation_log
         WHERE app_id = ? AND revision = ?
         ORDER BY operation_index`,
      )
      .all(appId, revision)
      .map((row) => {
        const operation = this.#parseLogOperation(
          requireString(row.operation_json, 'mutation operation'),
        );
        return {
          index: requireNumber(row.operation_index, 'mutation operation index'),
          operation,
          revision: requireNumber(row.revision, 'mutation revision'),
        };
      });
  }

  public incoming(
    appId: string,
    revision: number,
    semanticId: string,
  ): readonly ApplicationStoredReferenceV1[] {
    return this.#references('target_id', appId, revision, semanticId);
  }

  public outgoing(
    appId: string,
    revision: number,
    semanticId: string,
  ): readonly ApplicationStoredReferenceV1[] {
    return this.#references('source_id', appId, revision, semanticId);
  }

  public close(): void {
    if (this.#database.isOpen) this.#database.close();
  }

  public [Symbol.dispose](): void {
    this.close();
  }

  #references(
    column: 'source_id' | 'target_id',
    appId: string,
    revision: number,
    semanticId: string,
  ): readonly ApplicationStoredReferenceV1[] {
    return this.#database
      .prepare(
        `SELECT source_id, target_id, label, graph_path
         FROM application_references
         WHERE app_id = ? AND revision = ? AND ${column} = ?
         ORDER BY source_id, target_id, graph_path`,
      )
      .all(appId, revision, semanticId)
      .map((row) => ({
        label: requireString(row.label, 'reference label'),
        path: requireString(row.graph_path, 'reference path'),
        sourceId: requireString(row.source_id, 'reference source'),
        targetId: requireString(row.target_id, 'reference target'),
      }));
  }

  #initializePublication(appId: string, revision: number): void {
    this.#database
      .prepare(
        `INSERT INTO application_publications (app_id, active_revision, activated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (app_id) DO NOTHING`,
      )
      .run(appId, revision, this.#timestamp());
  }

  #headRow(appId: string): Record<string, unknown> | undefined {
    return this.#database
      .prepare(
        `SELECT app_id, current_revision, current_hash
         FROM application_heads WHERE app_id = ?`,
      )
      .get(appId);
  }

  #requiredHead(appId: string): Record<string, unknown> {
    const head = this.#headRow(appId);
    if (!head)
      throw new ApplicationRevisionStoreError(
        'OXE3303',
        `Application "${appId}" is not initialized.`,
      );
    return head;
  }

  #revisionRow(appId: string, revision: number): PersistedRevision | undefined {
    const row = this.#database
      .prepare(
        `SELECT app_id, revision, parent_revision, content_hash, graph_json, created_at, reason,
                node_count, reference_count, mutation_count
         FROM application_revisions WHERE app_id = ? AND revision = ?`,
      )
      .get(appId, revision);
    return row ? this.#revisionFromRow(row) : undefined;
  }

  #loadRevision(appId: string, revision: number): PersistedRevision {
    const persisted = this.#revisionRow(appId, revision);
    if (!persisted)
      throw new ApplicationRevisionStoreError(
        'OXE3303',
        `Application "${appId}" revision r${revision} does not exist.`,
      );
    return persisted;
  }

  #revisionAtHead(appId: string, head: Record<string, unknown>): PersistedRevision {
    const persisted = this.#loadRevision(
      appId,
      requireNumber(head.current_revision, 'head revision'),
    );
    if (persisted.metadata.contentHash !== requireString(head.current_hash, 'head hash'))
      throw new ApplicationRevisionStoreError(
        'OXE3302',
        `Stored head hash does not match r${persisted.metadata.revision}.`,
      );
    return persisted;
  }

  #revisionFromRow(row: Record<string, unknown>): PersistedRevision {
    const metadata = revisionMetadataFromRow(row);
    let parsed: unknown;
    try {
      parsed = JSON.parse(requireString(row.graph_json, 'graph JSON')) as unknown;
    } catch (error) {
      throw new ApplicationRevisionStoreError(
        'OXE3302',
        `Stored graph JSON for r${metadata.revision} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let graph: ApplicationGraphV1;
    try {
      graph = loadApplicationGraph(parsed);
    } catch (error) {
      if (error instanceof ApplicationGraphValidationError)
        throw new ApplicationRevisionStoreError(
          'OXE3302',
          `Stored graph for r${metadata.revision} is invalid: ${error.diagnostics[0]?.message ?? 'unknown graph error'}`,
        );
      throw error;
    }
    if (graph.app.id !== metadata.appId || graph.revision !== metadata.revision)
      throw new ApplicationRevisionStoreError(
        'OXE3302',
        `Stored graph identity does not match revision metadata for r${metadata.revision}.`,
      );
    if (contentHash(graph) !== metadata.contentHash)
      throw new ApplicationRevisionStoreError(
        'OXE3302',
        `Stored graph content hash does not match r${metadata.revision}.`,
      );
    return { graph, metadata };
  }

  #persistRevision(
    graph: ApplicationGraphV1,
    parentRevision: number | null,
    reason: ApplicationRevisionReasonV1,
    operations: readonly (ApplicationMutationOperationV1 | ApplicationUndoOperationV1)[],
  ): ApplicationRevisionMetadataV1 {
    const indexed = indexApplicationGraph(graph);
    const hash = contentHash(graph);
    const createdAt = this.#timestamp();
    const graphJson = serializeApplicationGraph(graph);
    this.#database
      .prepare(
        `INSERT INTO application_revisions
          (app_id, revision, parent_revision, content_hash, graph_json, created_at, reason,
           node_count, reference_count, mutation_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        graph.app.id,
        graph.revision,
        parentRevision,
        hash,
        graphJson,
        createdAt,
        reason,
        indexed.nodes.length,
        indexed.references.length,
        operations.length,
      );
    const insertNode = this.#database.prepare(
      `INSERT INTO application_nodes
        (app_id, revision, semantic_id, kind, graph_path, body_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const node of indexed.nodes)
      insertNode.run(graph.app.id, graph.revision, node.id, node.kind, node.path, node.bodyJson);
    const insertReference = this.#database.prepare(
      `INSERT INTO application_references
        (app_id, revision, source_id, target_id, label, graph_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const reference of indexed.references)
      insertReference.run(
        graph.app.id,
        graph.revision,
        reference.sourceId,
        reference.targetId,
        reference.label,
        reference.path,
      );
    const insertMutation = this.#database.prepare(
      `INSERT INTO application_mutation_log
        (app_id, revision, operation_index, operation_json)
       VALUES (?, ?, ?, ?)`,
    );
    operations.forEach((operation, index) =>
      insertMutation.run(
        graph.app.id,
        graph.revision,
        index,
        serializeCompactApplicationJson(operation),
      ),
    );
    return {
      appId: graph.app.id,
      contentHash: hash,
      createdAt,
      mutationCount: operations.length,
      nodeCount: indexed.nodes.length,
      parentRevision,
      reason,
      referenceCount: indexed.references.length,
      revision: graph.revision,
    };
  }

  #compareAndSetHead(
    appId: string,
    baseRevision: number,
    metadata: ApplicationRevisionMetadataV1,
  ): void {
    const result = this.#database
      .prepare(
        `UPDATE application_heads
         SET current_revision = ?, current_hash = ?
         WHERE app_id = ? AND current_revision = ?`,
      )
      .run(metadata.revision, metadata.contentHash, appId, baseRevision);
    if (Number(result.changes) !== 1)
      throw new ApplicationRevisionStoreError(
        'OXE3304',
        `Compare-and-commit lost the head for "${appId}" at r${baseRevision}.`,
      );
  }

  #parseLogOperation(json: string): ApplicationMutationOperationV1 | ApplicationUndoOperationV1 {
    let operation: unknown;
    try {
      operation = JSON.parse(json) as unknown;
    } catch (error) {
      throw new ApplicationRevisionStoreError(
        'OXE3302',
        `Stored mutation log JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      typeof operation === 'object' &&
      operation !== null &&
      !Array.isArray(operation) &&
      'op' in operation &&
      operation.op === 'revision.undo' &&
      'targetRevision' in operation &&
      typeof operation.targetRevision === 'number' &&
      Number.isSafeInteger(operation.targetRevision)
    )
      return { op: 'revision.undo', targetRevision: operation.targetRevision };
    if (validateApplicationMutationBatch({ base: 0, ops: [operation] }).length === 0)
      return operation as ApplicationMutationOperationV1;
    throw new ApplicationRevisionStoreError('OXE3302', 'Stored mutation log operation is invalid.');
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK');
      throw error;
    }
  }
}
