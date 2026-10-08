import { readFileSync } from 'node:fs';

import { loadApplicationGraph, type ApplicationGraphV1 } from '@oxe/graph';
import { describe, expect, it } from 'vitest';

import { ApplicationArtifactCache } from '../src/application-artifact-cache.js';
import {
  ApplicationPublicationError,
  ApplicationPublicationManager,
  type ApplicationPublicationAdapterV1,
} from '../src/application-publication.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

const revision = (base: ApplicationGraphV1, value: number): ApplicationGraphV1 =>
  loadApplicationGraph({
    ...base,
    app: { ...base.app, name: `TinyTodo r${value}` },
    revision: value,
  });

const setup = (adapter?: ApplicationPublicationAdapterV1): ApplicationPublicationManager => {
  const cache = new ApplicationArtifactCache();
  return new ApplicationPublicationManager(cache.compile(todoGraph()), {
    ...(adapter ? { adapter } : {}),
    clock: (() => {
      let tick = 0;
      return () => `2026-09-13T12:00:0${tick++}.000Z`;
    })(),
    compile: (graph) => cache.compile(graph),
  });
};

describe('application publication manager', () => {
  it('stages a build, activates it, and disposes the superseded runtime', async () => {
    const events: string[] = [];
    const manager = setup({
      prepare: ({ compilation, previous }) => {
        events.push(`prepare:${previous.revision}->${compilation.revision}`);
        return {
          activate: () => {
            events.push(`activate:${compilation.revision}`);
          },
          dispose: () => {
            events.push(`dispose:${compilation.revision}`);
          },
        };
      },
    });

    await manager.publish(revision(todoGraph(), 17));
    await manager.publish(revision(todoGraph(), 18));

    expect(manager.active().revision).toBe(18);
    expect(manager.state()).toEqual({
      activeRevision: 18,
      lastAttempt: {
        completedAt: '2026-09-13T12:00:03.000Z',
        revision: 18,
        startedAt: '2026-09-13T12:00:02.000Z',
        status: 'published',
      },
      schemaVersion: 'oxe.application-publication-state.v1',
      status: 'active',
    });
    expect(events).toEqual([
      'prepare:16->17',
      'activate:17',
      'prepare:17->18',
      'activate:18',
      'dispose:17',
    ]);
    await manager.close();
    expect(events.at(-1)).toBe('dispose:18');
  });

  it('keeps the last-good revision active when an isolated migration fails', async () => {
    const manager = setup({
      prepare: () => {
        throw new ApplicationPublicationError('migration', 'column conversion rejected');
      },
    });

    await expect(manager.publish(revision(todoGraph(), 17))).rejects.toMatchObject({
      message: 'column conversion rejected',
      stage: 'migration',
    });
    expect(manager.active().revision).toBe(16);
    expect(manager.state()).toMatchObject({
      activeRevision: 16,
      candidateRevision: 17,
      lastAttempt: {
        message: 'column conversion rejected',
        revision: 17,
        stage: 'migration',
        status: 'failed',
      },
      status: 'failed',
    });
  });

  it('disposes an unreachable candidate and keeps last-good artifacts on activation failure', async () => {
    let disposed = false;
    const manager = setup({
      prepare: () => ({
        activate: () => {
          throw new Error('health check failed');
        },
        dispose: () => {
          disposed = true;
        },
      }),
    });

    await expect(manager.publish(revision(todoGraph(), 17))).rejects.toMatchObject({
      stage: 'activation',
    });
    expect(disposed).toBe(true);
    expect(manager.active().revision).toBe(16);
    expect(manager.state()).toMatchObject({ activeRevision: 16, status: 'failed' });
  });

  it('attributes compilation failures to the build gate without preparing a runtime', async () => {
    const cache = new ApplicationArtifactCache();
    let prepared = false;
    const manager = new ApplicationPublicationManager(cache.compile(todoGraph()), {
      adapter: {
        prepare: () => {
          prepared = true;
          return { activate: () => undefined, dispose: () => undefined };
        },
      },
      compile: () => {
        throw new Error('bundle failed');
      },
    });

    await expect(manager.publish(revision(todoGraph(), 17))).rejects.toMatchObject({
      stage: 'build',
    });
    expect(prepared).toBe(false);
    expect(manager.active().revision).toBe(16);
  });

  it('serializes concurrent publications in revision order', async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstPrepared = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const manager = setup({
      prepare: async ({ compilation }) => {
        events.push(`prepare:${compilation.revision}`);
        if (compilation.revision === 17) await firstPrepared;
        return {
          activate: () => {
            events.push(`activate:${compilation.revision}`);
          },
          dispose: () => {
            events.push(`dispose:${compilation.revision}`);
          },
        };
      },
    });

    const first = manager.publish(revision(todoGraph(), 17));
    const second = manager.publish(revision(todoGraph(), 18));
    await Promise.resolve();
    expect(events).toEqual(['prepare:17']);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(events).toEqual([
      'prepare:17',
      'activate:17',
      'prepare:18',
      'activate:18',
      'dispose:17',
    ]);
    expect(manager.active().revision).toBe(18);
  });
});
