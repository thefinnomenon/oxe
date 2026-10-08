import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadApplicationGraph, type ApplicationGraphV1 } from '@oxe/graph';
import { ApplicationRevisionStore } from '@oxe/graph/store';
import { afterEach, describe, expect, it } from 'vitest';

import { ApplicationDevelopmentSession } from '../src/application-session.js';
import {
  ApplicationPublicationError,
  type ApplicationPublicationAdapterV1,
} from '../src/application-publication.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

const directories: string[] = [];
const sessions: ApplicationDevelopmentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

const setup = (
  publicationAdapter?: ApplicationPublicationAdapterV1,
): ApplicationDevelopmentSession => {
  const directory = mkdtempSync(join(tmpdir(), 'oxe-application-session-'));
  directories.push(directory);
  const session = new ApplicationDevelopmentSession(
    new ApplicationRevisionStore(join(directory, 'application.sqlite')),
    todoGraph(),
    undefined,
    publicationAdapter,
  );
  sessions.push(session);
  return session;
};

describe('application development session', () => {
  it('connects inspection, preview, CAS revision commit, history, and artifact publication', () => {
    const session = setup();
    expect(session.artifacts('app.todo')).toMatchObject({
      revision: 16,
      stats: { built: 0, reused: 19 },
    });

    const batch = {
      base: 16,
      ops: [
        {
          as: 'priority',
          default: 'normal',
          entity: 'entity.task',
          name: 'priority',
          op: 'field.add' as const,
          type: { enum: ['low', 'normal', 'high'] },
        },
        {
          field: '$priority',
          form: 'element.createTaskForm',
          op: 'form.field.add' as const,
        },
        {
          field: '$priority',
          list: 'element.taskList',
          op: 'list.display.add' as const,
        },
      ],
    };
    const preview = session.request('app.todo', 'preview-priority', {
      batch,
      kind: 'preview',
    });
    expect(preview).toMatchObject({
      ok: true,
      result: { artifactPlan: { rebuildAll: false }, kind: 'preview', preview: { ok: true } },
      revision: 16,
    });
    if (!preview.ok || preview.result.kind !== 'preview' || !preview.result.previewFingerprint)
      throw new Error('Expected a successful session preview.');

    const commit = session.request('app.todo', 'commit-priority', {
      batch,
      kind: 'commit',
      previewFingerprint: preview.result.previewFingerprint,
    });
    expect(commit).toMatchObject({
      ok: true,
      result: {
        kind: 'commit',
        parentRevision: 16,
        publication: { stats: { removed: 0 } },
      },
      revision: 17,
    });
    if (!commit.ok || commit.result.kind !== 'commit' || !commit.result.publication)
      throw new Error('Expected a published session commit.');
    expect(commit.result.publication.stats.built).toBeGreaterThan(0);
    expect(commit.result.publication.stats.reused).toBeGreaterThan(0);
    expect(session.artifacts('app.todo')?.revision).toBe(17);

    const history = session.request('app.todo', 'inspect-history', {
      inspect: { kind: 'history' },
      kind: 'inspect',
    });
    expect(history).toMatchObject({
      ok: true,
      result: {
        kind: 'inspect.history',
        revisions: [{ revision: 17 }, { revision: 16 }],
      },
    });
  });

  it('reopens an existing advanced head without trying to reinitialize the fixture revision', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-application-session-reopen-'));
    directories.push(directory);
    const path = join(directory, 'application.sqlite');
    const first = new ApplicationDevelopmentSession(
      new ApplicationRevisionStore(path),
      todoGraph(),
    );
    const graph = first.store.current('app.todo');
    if (!graph) throw new Error('Todo application was not initialized.');
    const query = graph.queries.find((candidate) => candidate.id === 'query.myTasks');
    if (!query) throw new Error('Todo query is missing.');
    const commit = first.request('app.todo', 'commit-cache-policy', {
      batch: {
        base: graph.revision,
        ops: [{ node: { ...query, cache: { kind: 'no-store' } }, op: 'semantic.replace' }],
      },
      kind: 'commit',
    });
    expect(commit).toMatchObject({ ok: true, revision: 17 });
    await first.close();

    const reopened = new ApplicationDevelopmentSession(
      new ApplicationRevisionStore(path),
      todoGraph(),
    );
    sessions.push(reopened);
    expect(reopened.store.current('app.todo')?.revision).toBe(17);
    expect(reopened.artifacts('app.todo')?.revision).toBe(17);
  });

  it('commits the graph but preserves the active revision when migration preparation fails', async () => {
    const session = setup({
      prepare: () => {
        throw new ApplicationPublicationError('migration', 'migration rehearsal failed');
      },
    });
    const graph = session.store.current('app.todo');
    const query = graph?.queries.find((candidate) => candidate.id === 'query.myTasks');
    if (!graph || !query) throw new Error('Todo application query was not initialized.');

    const response = await session.requestAndPublish('app.todo', 'commit-failed-publication', {
      batch: {
        base: graph.revision,
        ops: [{ node: { ...query, cache: { kind: 'no-store' } }, op: 'semantic.replace' }],
      },
      kind: 'commit',
    });

    expect(response).toMatchObject({
      diagnostics: [{ code: 'OXE3404' }],
      ok: false,
    });
    expect(session.store.current('app.todo')?.revision).toBe(17);
    expect(session.artifacts('app.todo')?.revision).toBe(16);
    expect(session.publicationState()).toMatchObject({
      activeRevision: 16,
      candidateRevision: 17,
      lastAttempt: { stage: 'migration', status: 'failed' },
      status: 'failed',
    });
  });
});
