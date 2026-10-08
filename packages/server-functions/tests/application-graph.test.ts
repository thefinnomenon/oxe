import { readFileSync } from 'node:fs';

import { lowerApplicationRouteToUiGraph } from '@oxe/compiler';
import {
  loadApplicationGraph,
  type ApplicationExecutionContextV1,
  type ApplicationStoredRecordV1,
} from '@oxe/graph';
import { describe, expect, it } from 'vitest';

import {
  createInProcessServerFunctionTransport,
  createServerFunctionCapabilityMap,
} from '../src/index.js';
import { createInMemoryApplicationServerFunctions } from '../src/application.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);

const task = (
  id: string,
  ownerId: string,
  title: string,
  createdAt: string,
): ApplicationStoredRecordV1 => ({
  entityId: 'entity.task',
  fields: {
    'field.task.createdAt': createdAt,
    'field.task.done': false,
    'field.task.id': id,
    'field.task.title': title,
  },
  relations: {
    'relation.taskOwner': ownerId,
    'relation.taskTeam': ownerId === 'user-alice' ? 'team-a' : 'team-b',
  },
});

const team = (id: string, ownerId: string, name: string): ApplicationStoredRecordV1 => ({
  entityId: 'entity.team',
  fields: {
    'field.team.createdAt': '2026-08-25T10:00:00.000Z',
    'field.team.id': id,
    'field.team.name': name,
  },
  relations: { 'relation.teamOwner': ownerId },
});

describe('application graph server-function runtime', () => {
  it('executes generated contracts with authoritative state and actor policies', async () => {
    const graph = loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);
    const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
    const application = createInMemoryApplicationServerFunctions(graph, definitions, {
      now: () => '2026-08-28T10:00:00.000Z',
      records: [
        team('team-a', 'user-alice', 'Alice team'),
        team('team-b', 'user-bob', 'Bob team'),
        task('task-a', 'user-alice', 'Alice task', '2026-08-26T10:00:00.000Z'),
        task('task-b', 'user-bob', 'Bob task', '2026-08-27T10:00:00.000Z'),
      ],
    });
    const capabilitiesFor = (context: ApplicationExecutionContextV1) =>
      createServerFunctionCapabilityMap(
        definitions,
        createInProcessServerFunctionTransport(application.registry, () => context),
      );
    const capability = (capabilities: ReturnType<typeof capabilitiesFor>, id: string) => {
      const definition = definitions.find((candidate) => candidate.id === id);
      if (!definition) throw new Error(`Missing definition ${id}`);
      const result = capabilities.get(definition.path.join('.'));
      if (!result) throw new Error(`Missing capability ${id}`);
      return result;
    };
    const alice = capabilitiesFor({
      activeContexts: [{ contextId: 'context.team', entityId: 'entity.team', recordId: 'team-a' }],
      userId: 'user-alice',
    });
    const bob = capabilitiesFor({
      activeContexts: [{ contextId: 'context.team', entityId: 'entity.team', recordId: 'team-b' }],
      userId: 'user-bob',
    });
    const anonymous = capabilitiesFor({});
    const signal = new AbortController().signal;

    await expect(capability(alice, 'app.todo/query.myTasks')(signal)).resolves.toEqual([
      {
        createdAt: '2026-08-26T10:00:00.000Z',
        done: false,
        id: 'task-a',
        title: 'Alice task',
      },
    ]);
    await expect(
      capability(alice, 'app.todo/operation.createTask')('New task', signal),
    ).resolves.toEqual({
      createdAt: '2026-08-28T10:00:00.000Z',
      done: false,
      id: 'task-3',
      title: 'New task',
    });
    const forgedAliceTask = {
      createdAt: '1900-01-01T00:00:00.000Z',
      done: true,
      id: 'task-a',
      title: 'Forged title',
    };
    await expect(
      capability(alice, 'app.todo/operation.toggleTask')(forgedAliceTask, signal),
    ).resolves.toEqual({
      createdAt: '2026-08-26T10:00:00.000Z',
      done: true,
      id: 'task-a',
      title: 'Alice task',
    });
    await expect(
      capability(bob, 'app.todo/operation.toggleTask')({ ...forgedAliceTask, done: false }, signal),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(
      capability(alice, 'app.todo/operation.renameTask')(
        { ...forgedAliceTask, done: true },
        'Renamed task',
        signal,
      ),
    ).resolves.toMatchObject({ id: 'task-a', title: 'Renamed task' });
    await expect(
      capability(bob, 'app.todo/operation.deleteTask')(forgedAliceTask, signal),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(
      capability(alice, 'app.todo/operation.deleteTask')(
        {
          createdAt: '2026-08-28T10:00:00.000Z',
          done: false,
          id: 'task-3',
          title: 'New task',
        },
        signal,
      ),
    ).resolves.toMatchObject({ id: 'task-3' });
    await expect(capability(anonymous, 'app.todo/query.myTasks')(signal)).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    await expect(capability(alice, 'app.todo/operation.createTask')('', signal)).rejects.toThrow(
      'at least 1 characters',
    );
    await expect(capability(bob, 'app.todo/query.myTasks')(signal)).resolves.toEqual([
      {
        createdAt: '2026-08-27T10:00:00.000Z',
        done: false,
        id: 'task-b',
        title: 'Bob task',
      },
    ]);
    expect(application.host.snapshot().revision).toBe(4);
  });
});
