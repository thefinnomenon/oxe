import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  indexApplicationGraph,
  loadApplicationGraph,
  projectCompactApplicationGraph,
  serializeApplicationGraph,
  type ApplicationGraphV1,
  type ApplicationMutationBatchV1,
} from '../src/index.js';
import { ApplicationRevisionStore, ApplicationRevisionStoreError } from '../src/store.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);

const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

const priorityBatch: ApplicationMutationBatchV1 = {
  base: 16,
  ops: [
    {
      as: 'priority',
      default: 'normal',
      entity: 'entity.task',
      name: 'priority',
      op: 'field.add',
      type: { enum: ['low', 'normal', 'high'] },
    },
    {
      field: '$priority',
      form: 'element.createTaskForm',
      op: 'form.field.add',
    },
    {
      field: '$priority',
      list: 'element.taskList',
      op: 'list.display.add',
    },
  ],
};

const tempDirectories: string[] = [];
const tempDatabase = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'oxe-application-store-'));
  tempDirectories.push(directory);
  return join(directory, 'application.sqlite');
};

afterEach(() => {
  for (const directory of tempDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

describe('application graph revision storage', () => {
  it('canonicalizes semantic node indexes and references deterministically', () => {
    const graph = todoGraph();
    const reordered: ApplicationGraphV1 = {
      ...graph,
      entities: [...graph.entities].reverse(),
      fields: [...graph.fields].reverse(),
      operations: [...graph.operations].reverse(),
    };

    expect(serializeApplicationGraph(reordered)).toBe(serializeApplicationGraph(graph));
    expect(indexApplicationGraph(reordered)).toEqual(indexApplicationGraph(graph));

    const indexed = indexApplicationGraph(graph);
    expect(new Set(indexed.nodes.map((node) => node.id)).size).toBe(indexed.nodes.length);
    expect(indexed.references).toContainEqual({
      label: 'query',
      path: '$.views[0].data.tasks.query',
      sourceId: 'view.tasks',
      targetId: 'query.myTasks',
    });
    const semanticLookingLiteral: ApplicationGraphV1 = {
      ...graph,
      features: graph.features.map((feature, index) =>
        index === 0 ? { ...feature, name: 'entity.task' } : feature,
      ),
    };
    expect(
      indexApplicationGraph(semanticLookingLiteral).references.some(
        (reference) => reference.path === '$.features[0].name',
      ),
    ).toBe(false);
  });

  it('initializes, reloads, and preserves immutable revision metadata in WAL mode', () => {
    const databasePath = tempDatabase();
    const timestamp = '2026-08-27T04:00:00.000Z';
    const store = new ApplicationRevisionStore(databasePath, { timestamp: () => timestamp });
    const graph = todoGraph();

    const metadata = store.initialize(graph);
    expect(store.journalMode).toBe('wal');
    expect(metadata).toMatchObject({
      appId: 'app.todo',
      createdAt: timestamp,
      mutationCount: 0,
      parentRevision: null,
      reason: 'initialize',
      revision: 16,
    });
    expect(metadata.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(metadata.nodeCount).toBeGreaterThan(0);
    expect(metadata.referenceCount).toBeGreaterThan(0);
    expect(serializeApplicationGraph(store.current('app.todo')!)).toBe(
      serializeApplicationGraph(graph),
    );
    expect(store.initialize(graph)).toEqual(metadata);
    expect(store.history('app.todo')).toEqual([metadata]);
    expect(store.activePublication('app.todo')).toEqual({
      activatedAt: timestamp,
      appId: 'app.todo',
      revision: 16,
    });
    store.close();

    const reopened = new ApplicationRevisionStore(databasePath);
    expect(reopened.metadata('app.todo', 16)).toEqual(metadata);
    expect(reopened.activePublication('app.todo')?.revision).toBe(16);
    expect(serializeApplicationGraph(reopened.load('app.todo', 16)!)).toBe(
      serializeApplicationGraph(graph),
    );
    reopened.close();
  });

  it('commits an atomic batch with an ordered mutation log and queryable reference edges', () => {
    const store = new ApplicationRevisionStore(tempDatabase());
    store.initialize(todoGraph());

    const result = store.commit('app.todo', priorityBatch);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);

    expect(result).toMatchObject({ baseRevision: 16, parentRevision: 16, revision: 17 });
    expect(store.activePublication('app.todo')?.revision).toBe(16);
    expect(store.activate('app.todo', 17)).toMatchObject({ appId: 'app.todo', revision: 17 });
    expect(store.activePublication('app.todo')?.revision).toBe(17);
    expect(
      store.history('app.todo').map(({ parentRevision, reason, revision }) => ({
        parentRevision,
        reason,
        revision,
      })),
    ).toEqual([
      { parentRevision: null, reason: 'initialize', revision: 16 },
      { parentRevision: 16, reason: 'mutation', revision: 17 },
    ]);
    expect(
      store.mutationLog('app.todo', 17).map(({ index, operation }) => ({
        index,
        operation,
      })),
    ).toEqual(priorityBatch.ops.map((operation, index) => ({ index, operation })));
    expect(store.incoming('app.todo', 17, 'field.task.priority')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'entity.task', targetId: 'field.task.priority' }),
        expect.objectContaining({
          sourceId: 'operation.createTask',
          targetId: 'field.task.priority',
        }),
        expect.objectContaining({ sourceId: 'query.myTasks', targetId: 'field.task.priority' }),
      ]),
    );
    expect(store.outgoing('app.todo', 17, 'query.myTasks')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: 'entity.task' }),
        expect.objectContaining({ targetId: 'field.task.priority' }),
        expect.objectContaining({ targetId: 'relation.taskTeam' }),
      ]),
    );
    expect(projectCompactApplicationGraph(store.current('app.todo')!)).toContain(
      'F3 priority: enum(low,normal,high) = "normal"',
    );
    store.close();
  });

  it('rolls back the complete transaction when a semantic operation fails', () => {
    const store = new ApplicationRevisionStore(tempDatabase());
    store.initialize(todoGraph());
    const fieldAdd = priorityBatch.ops[0];
    if (!fieldAdd) throw new Error('Priority batch is missing its field operation.');

    const result = store.commit('app.todo', {
      base: 16,
      ops: [fieldAdd, { field: '$priority', list: 'element.missing', op: 'list.display.add' }],
    });

    expect(result.ok).toBe(false);
    expect(store.current('app.todo')?.revision).toBe(16);
    expect(store.history('app.todo')).toHaveLength(1);
    expect(store.mutationLog('app.todo', 17)).toEqual([]);
    store.close();
  });

  it('rejects stale compare-and-commit attempts across store connections', () => {
    const databasePath = tempDatabase();
    const first = new ApplicationRevisionStore(databasePath);
    const second = new ApplicationRevisionStore(databasePath);
    first.initialize(todoGraph());

    expect(first.commit('app.todo', priorityBatch).ok).toBe(true);
    const stale = second.commit('app.todo', priorityBatch);

    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('Expected the stale commit to fail.');
    expect(stale.diagnostics).toEqual([
      {
        code: 'OXE3201',
        message: 'Mutation base r16 does not match current revision r17.',
        path: '$.base',
      },
    ]);
    expect(second.history('app.todo')).toHaveLength(2);
    expect(second.current('app.todo')?.revision).toBe(17);
    first.close();
    second.close();
  });

  it('undoes by committing a new revision while retaining prior revisions and hashes', () => {
    const store = new ApplicationRevisionStore(tempDatabase());
    const initial = store.initialize(todoGraph());
    const committed = store.commit('app.todo', priorityBatch);
    expect(committed.ok).toBe(true);

    const undone = store.undo('app.todo', 17, 16);
    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error(undone.diagnostics[0]?.message);

    expect(undone).toMatchObject({ baseRevision: 17, parentRevision: 17, revision: 18 });
    expect(undone.contentHash).toBe(initial.contentHash);
    expect(store.metadata('app.todo', 18)).toMatchObject({
      contentHash: initial.contentHash,
      parentRevision: 17,
      reason: 'undo',
    });
    expect(store.mutationLog('app.todo', 18)).toEqual([
      {
        index: 0,
        operation: { op: 'revision.undo', targetRevision: 16 },
        revision: 18,
      },
    ]);
    expect(projectCompactApplicationGraph(store.current('app.todo')!)).not.toContain('priority');
    expect(projectCompactApplicationGraph(store.load('app.todo', 17)!)).toContain('priority');
    expect(store.history('app.todo').map(({ revision }) => revision)).toEqual([16, 17, 18]);
    store.close();
  });

  it('enforces immutable rows and creates the incoming and outgoing indexes', () => {
    const databasePath = tempDatabase();
    const store = new ApplicationRevisionStore(databasePath);
    store.initialize(todoGraph());
    store.close();

    const database = new DatabaseSync(databasePath);
    const indexes = database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'index' AND tbl_name = 'application_references'
         ORDER BY name`,
      )
      .all()
      .map((row) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'application_references_incoming',
        'application_references_outgoing',
      ]),
    );
    expect(() =>
      database
        .prepare(
          `UPDATE application_revisions SET reason = 'undo'
           WHERE app_id = 'app.todo' AND revision = 16`,
        )
        .run(),
    ).toThrow(/application revisions are immutable/u);
    database.close();
  });

  it('detects a corrupted mutable head hash before returning authoritative state', () => {
    const databasePath = tempDatabase();
    const store = new ApplicationRevisionStore(databasePath);
    store.initialize(todoGraph());
    store.close();
    const database = new DatabaseSync(databasePath);
    database
      .prepare(`UPDATE application_heads SET current_hash = 'sha256:corrupt' WHERE app_id = ?`)
      .run('app.todo');
    database.close();

    const reopened = new ApplicationRevisionStore(databasePath);
    expect.assertions(2);
    try {
      reopened.current('app.todo');
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationRevisionStoreError);
      if (!(error instanceof ApplicationRevisionStoreError)) throw error;
      expect(error.code).toBe('OXE3302');
    }
    reopened.close();
  });
});
