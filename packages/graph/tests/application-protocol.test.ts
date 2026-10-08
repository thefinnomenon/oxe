import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  APPLICATION_AGENT_REQUEST_SCHEMA,
  APPLICATION_AGENT_RESPONSE_SCHEMA,
  executeApplicationAgentRequest,
  loadApplicationGraph,
  validateApplicationAgentRequest,
  type ApplicationAgentProtocolAdapterV1,
  type ApplicationAgentRequestV1,
  type ApplicationGraphV1,
  type ApplicationMutationBatchV1,
} from '../src/index.js';
import { ApplicationRevisionStore } from '../src/store.js';

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
    { field: '$priority', form: 'element.createTaskForm', op: 'form.field.add' },
    { field: '$priority', list: 'element.taskList', op: 'list.display.add' },
  ],
};

const tempDirectories: string[] = [];
const stores: ApplicationRevisionStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of tempDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

const setup = (): {
  adapter: ApplicationAgentProtocolAdapterV1;
  published: string[];
  store: ApplicationRevisionStore;
} => {
  const directory = mkdtempSync(join(tmpdir(), 'oxe-application-protocol-'));
  tempDirectories.push(directory);
  const store = new ApplicationRevisionStore(join(directory, 'application.sqlite'));
  stores.push(store);
  store.initialize(todoGraph());
  const published: string[] = [];
  return {
    adapter: {
      commit: (appId, batch) => store.commit(appId, batch),
      current: (appId) => store.current(appId),
      history: (appId) => store.history(appId),
      load: (appId, revision) => store.load(appId, revision),
      planArtifacts: (_before, after) => ({
        artifacts: [
          { id: 'application/manifest.json', kind: 'manifest', semanticIds: [after.app.id] },
        ],
        rebuildAll: false,
        schemaVersion: 'oxe.application-artifact-invalidation.v1',
      }),
      publishArtifacts: (_before, after) => {
        published.push(`${after.app.id}@${after.revision}`);
        return {
          artifacts: [
            {
              bytes: 17,
              fingerprint: `artifact-r${after.revision}`,
              id: 'application/manifest.json',
              status: 'built',
            },
          ],
          stats: { built: 1, removed: 0, reused: 0 },
        };
      },
      undo: (appId, baseRevision, targetRevision) =>
        store.undo(appId, baseRevision, targetRevision),
    },
    published,
    store,
  };
};

const request = (
  operation: ApplicationAgentRequestV1['operation'],
  requestId = 'request-1',
): ApplicationAgentRequestV1 => ({
  appId: 'app.todo',
  operation,
  requestId,
  schemaVersion: APPLICATION_AGENT_REQUEST_SCHEMA,
});

describe('versioned application agent protocol', () => {
  it('validates an exact request boundary with stable paths', () => {
    expect(
      validateApplicationAgentRequest({
        appId: 'app.todo',
        extra: true,
        operation: { inspect: { kind: 'history', limit: 0 }, kind: 'inspect' },
        requestId: '',
        schemaVersion: 'oxe.application-agent-request.v0',
      }),
    ).toEqual([
      {
        code: 'OXE3401',
        message: 'Unknown protocol property "extra".',
        path: '$.extra',
      },
      {
        code: 'OXE3401',
        message: `Agent request schema must be "${APPLICATION_AGENT_REQUEST_SCHEMA}".`,
        path: '$.schemaVersion',
      },
      {
        code: 'OXE3401',
        message: 'requestId must be a non-empty string.',
        path: '$.requestId',
      },
      {
        code: 'OXE3401',
        message: 'Inspection limit must be an integer from 1 through 100.',
        path: '$.operation.inspect.limit',
      },
    ]);
  });

  it('inspects compact maps, semantic nodes, searches, incoming edges, and history', () => {
    const { adapter } = setup();
    const map = executeApplicationAgentRequest(
      adapter,
      request({ inspect: { kind: 'map' }, kind: 'inspect' }),
    );
    expect(map).toMatchObject({
      ok: true,
      result: { kind: 'inspect.map', size: { characters: 1874 } },
      revision: 16,
      schemaVersion: APPLICATION_AGENT_RESPONSE_SCHEMA,
    });
    if (!map.ok || map.result.kind !== 'inspect.map') throw new Error('Expected map inspection.');
    expect(map.result.projection).toContain('TinyTodo r16');

    const node = executeApplicationAgentRequest(
      adapter,
      request({ inspect: { kind: 'node', semanticId: 'query.myTasks' }, kind: 'inspect' }),
    );
    expect(node).toMatchObject({
      ok: true,
      result: {
        kind: 'inspect.node',
        node: { id: 'query.myTasks', kind: 'query' },
      },
    });

    const search = executeApplicationAgentRequest(
      adapter,
      request({ inspect: { kind: 'search', text: 'MYTASKS' }, kind: 'inspect' }),
    );
    expect(search).toMatchObject({ ok: true, result: { kind: 'inspect.search' } });
    if (!search.ok || search.result.kind !== 'inspect.search')
      throw new Error('Expected search inspection.');
    expect(search.result.matches.map((match) => match.id)).toContain('query.myTasks');

    const incoming = executeApplicationAgentRequest(
      adapter,
      request({ inspect: { kind: 'incoming', semanticId: 'query.myTasks' }, kind: 'inspect' }),
    );
    expect(incoming).toMatchObject({
      ok: true,
      result: { kind: 'inspect.incoming', semanticId: 'query.myTasks' },
    });
    if (!incoming.ok || incoming.result.kind !== 'inspect.incoming')
      throw new Error('Expected incoming inspection.');
    expect(incoming.result.references.map((reference) => reference.sourceId)).toContain(
      'view.tasks',
    );

    const history = executeApplicationAgentRequest(
      adapter,
      request({ inspect: { kind: 'history' }, kind: 'inspect' }),
    );
    expect(history).toMatchObject({
      ok: true,
      result: { kind: 'inspect.history', revisions: [{ reason: 'initialize', revision: 16 }] },
    });
  });

  it('previews without publishing and commits only the reviewed graph fingerprint', () => {
    const { adapter, published, store } = setup();
    const preview = executeApplicationAgentRequest(
      adapter,
      request({ batch: priorityBatch, kind: 'preview' }),
    );
    expect(store.current('app.todo')?.revision).toBe(16);
    expect(published).toEqual([]);
    expect(preview).toMatchObject({
      ok: true,
      result: {
        artifactPlan: { artifacts: [{ id: 'application/manifest.json' }] },
        kind: 'preview',
        preview: { ok: true },
      },
      revision: 16,
    });
    if (!preview.ok || preview.result.kind !== 'preview' || !preview.result.previewFingerprint)
      throw new Error('Expected successful preview.');

    const mismatched = executeApplicationAgentRequest(
      adapter,
      request({ batch: priorityBatch, kind: 'commit', previewFingerprint: 'wrong' }, 'request-2'),
    );
    expect(mismatched).toMatchObject({
      diagnostics: [{ code: 'OXE3403', path: '$.operation.previewFingerprint' }],
      ok: false,
    });
    expect(store.current('app.todo')?.revision).toBe(16);

    const committed = executeApplicationAgentRequest(
      adapter,
      request(
        {
          batch: priorityBatch,
          kind: 'commit',
          previewFingerprint: preview.result.previewFingerprint,
        },
        'request-3',
      ),
    );
    expect(committed).toMatchObject({
      ok: true,
      requestId: 'request-3',
      result: {
        kind: 'commit',
        parentRevision: 16,
        publication: { stats: { built: 1, removed: 0, reused: 0 } },
      },
      revision: 17,
    });
    expect(published).toEqual(['app.todo@17']);
    expect(store.history('app.todo').map(({ revision }) => revision)).toEqual([16, 17]);

    const nodes = executeApplicationAgentRequest(
      adapter,
      request({ inspect: { kind: 'nodes', kinds: ['field'], limit: 3 }, kind: 'inspect' }),
    );
    expect(nodes).toMatchObject({
      ok: true,
      result: {
        kind: 'inspect.nodes',
        nodes: [
          { id: 'field.membership.accepted', kind: 'field' },
          { id: 'field.membership.createdAt', kind: 'field' },
          { id: 'field.membership.id', kind: 'field' },
        ],
      },
      revision: 17,
    });

    const diff = executeApplicationAgentRequest(
      adapter,
      request({ inspect: { fromRevision: 16, kind: 'diff' }, kind: 'inspect' }),
    );
    expect(diff).toMatchObject({
      ok: true,
      result: {
        fromRevision: 16,
        kind: 'inspect.diff',
        toRevision: 17,
      },
      revision: 17,
    });
    if (!diff.ok || diff.result.kind !== 'inspect.diff')
      throw new Error('Expected revision diff inspection.');
    expect(diff.result.impact.changes).toEqual(
      expect.arrayContaining([
        { change: 'changed', id: 'entity.task', kind: 'entity' },
        { change: 'added', id: 'field.task.priority', kind: 'field' },
      ]),
    );
  });

  it('restores an earlier graph as a new revision with stale-head protection', () => {
    const { adapter, published, store } = setup();
    const preview = executeApplicationAgentRequest(
      adapter,
      request({ batch: priorityBatch, kind: 'preview' }),
    );
    if (!preview.ok || preview.result.kind !== 'preview' || !preview.result.previewFingerprint)
      throw new Error('Expected successful preview.');
    executeApplicationAgentRequest(
      adapter,
      request({
        batch: priorityBatch,
        kind: 'commit',
        previewFingerprint: preview.result.previewFingerprint,
      }),
    );

    const stale = executeApplicationAgentRequest(
      adapter,
      request({ baseRevision: 16, kind: 'revert', targetRevision: 16 }, 'stale-revert'),
    );
    expect(stale).toMatchObject({ diagnostics: [{ code: 'OXE3403' }], ok: false });

    const restored = executeApplicationAgentRequest(
      adapter,
      request({ baseRevision: 17, kind: 'revert', targetRevision: 16 }, 'restore'),
    );
    expect(restored).toMatchObject({
      ok: true,
      requestId: 'restore',
      result: {
        kind: 'revert',
        parentRevision: 17,
        restoredRevision: 16,
      },
      revision: 18,
    });
    expect(store.current('app.todo')).toMatchObject({ revision: 18 });
    expect(store.current('app.todo')?.entities.some((entity) => entity.id === 'entity.task')).toBe(
      true,
    );
    expect(published).toEqual(['app.todo@17', 'app.todo@18']);
  });

  it('reports missing revisions and failed semantic previews without changing the head', () => {
    const { adapter, store } = setup();
    const missing = executeApplicationAgentRequest(
      adapter,
      request({ inspect: { kind: 'map' }, kind: 'inspect', revision: 99 }),
    );
    expect(missing).toMatchObject({ diagnostics: [{ code: 'OXE3402' }], ok: false });

    const removal: ApplicationMutationBatchV1 = {
      base: 16,
      ops: [{ node: 'query.myTasks', op: 'semantic.remove' }],
    };
    const preview = executeApplicationAgentRequest(
      adapter,
      request({ batch: removal, kind: 'preview' }),
    );
    expect(preview).toMatchObject({
      ok: true,
      result: { kind: 'preview', preview: { ok: false } },
      revision: 16,
    });
    const commit = executeApplicationAgentRequest(
      adapter,
      request({ batch: removal, kind: 'commit' }),
    );
    expect(commit).toMatchObject({ diagnostics: [{ code: 'OXE3403' }], ok: false });
    expect(store.current('app.todo')?.revision).toBe(16);
  });
});
