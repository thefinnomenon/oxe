import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ApplicationHostError,
  createApplicationTelemetryCollector,
  createInMemoryApplicationHost,
  loadApplicationGraph,
  type ApplicationExecutionContextV1,
  type ApplicationGraphV1,
  type ApplicationStoredRecordV1,
} from '../src/index.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);

const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

const workflowGraph = (rollback = false): ApplicationGraphV1 => {
  const graph = todoGraph();
  return loadApplicationGraph({
    ...graph,
    operations: [
      ...graph.operations,
      rollback
        ? {
            body: {
              kind: 'workflow',
              result: { kind: 'local', name: 'deleted' },
              steps: [
                {
                  as: 'deleted',
                  entity: 'entity.task',
                  kind: 'deleteEntity',
                  record: { kind: 'inputField', name: 'task' },
                },
                {
                  as: 'deletedAgain',
                  entity: 'entity.task',
                  kind: 'deleteEntity',
                  record: { kind: 'local', name: 'deleted' },
                },
              ],
            },
            effects: [{ kind: 'databaseWrite', target: 'entity.task' }],
            id: 'operation.rollbackWorkflow',
            input: {
              fields: { task: { entity: 'entity.task', kind: 'entity' } },
              kind: 'record',
            },
            kind: 'operation',
            name: 'Rollback workflow',
            output: { entity: 'entity.task', kind: 'entity' },
          }
        : {
            body: {
              kind: 'workflow',
              result: { kind: 'local', name: 'toggled' },
              steps: [
                {
                  as: 'renamed',
                  entity: 'entity.task',
                  kind: 'updateEntity',
                  record: { kind: 'inputField', name: 'task' },
                  values: { 'field.task.title': { kind: 'inputField', name: 'title' } },
                },
                {
                  as: 'toggled',
                  entity: 'entity.task',
                  kind: 'updateEntity',
                  record: { kind: 'local', name: 'renamed' },
                  values: {
                    'field.task.done': {
                      kind: 'not',
                      value: {
                        field: 'field.task.done',
                        kind: 'recordField',
                        record: { kind: 'local', name: 'renamed' },
                      },
                    },
                  },
                },
              ],
            },
            effects: [
              { kind: 'databaseWrite', target: 'field.task.done' },
              { kind: 'databaseWrite', target: 'field.task.title' },
            ],
            id: 'operation.renameAndToggleTask',
            input: {
              fields: {
                task: { entity: 'entity.task', kind: 'entity' },
                title: { kind: 'string' },
              },
              kind: 'record',
            },
            kind: 'operation',
            name: 'Rename and toggle task',
            output: { entity: 'entity.task', kind: 'entity' },
          },
    ],
  });
};

const capabilityGraph = (): ApplicationGraphV1 => {
  const graph = todoGraph();
  return loadApplicationGraph({
    ...graph,
    capabilities: [
      {
        contract: 'oxe.capability.mail',
        id: 'capability.mail',
        kind: 'capability',
        methods: {
          send: {
            input: {
              fields: { subject: { kind: 'string' }, to: { kind: 'string' } },
              kind: 'record',
            },
            output: {
              fields: { deliveryId: { kind: 'string' } },
              kind: 'record',
            },
          },
        },
        name: 'Mail',
        version: '1',
      },
    ],
    operations: [
      ...graph.operations,
      {
        body: {
          arguments: {
            subject: { kind: 'inputField', name: 'subject' },
            to: { kind: 'inputField', name: 'to' },
          },
          capability: 'capability.mail',
          kind: 'invokeCapability',
          method: 'send',
        },
        effects: [{ kind: 'externalCall', target: 'capability.mail' }],
        id: 'operation.sendMail',
        input: {
          fields: { subject: { kind: 'string' }, to: { kind: 'string' } },
          kind: 'record',
        },
        kind: 'operation',
        name: 'Send mail',
        output: { fields: { deliveryId: { kind: 'string' } }, kind: 'record' },
      },
    ],
  });
};

const resultCapabilityGraph = (): ApplicationGraphV1 => {
  const graph = capabilityGraph();
  const input = {
    fields: {
      budget: { kind: 'decimal', precision: 6, scale: 2 },
      cc: { kind: 'optional', value: { kind: 'email' } },
      tags: { items: { kind: 'string' }, kind: 'list', maximumItems: 3 },
      to: { kind: 'email' },
    },
    kind: 'record',
  } as const;
  const output = {
    kind: 'result',
    outcomes: {
      rejected: { fields: { reason: { kind: 'string' } }, kind: 'record' },
    },
    value: { fields: { deliveryId: { kind: 'string' } }, kind: 'record' },
  } as const;
  return loadApplicationGraph({
    ...graph,
    capabilities: graph.capabilities?.map((capability) => ({
      ...capability,
      methods: { send: { input, output } },
    })),
    operations: graph.operations.map((operation) =>
      operation.id === 'operation.sendMail'
        ? {
            ...operation,
            body: {
              arguments: {
                budget: { kind: 'inputField', name: 'budget' },
                cc: { kind: 'inputField', name: 'cc' },
                tags: { kind: 'inputField', name: 'tags' },
                to: { kind: 'inputField', name: 'to' },
              },
              capability: 'capability.mail',
              kind: 'invokeCapability',
              method: 'send',
            },
            input,
            output,
          }
        : operation,
    ),
  });
};

const queuedCapabilityGraph = (): ApplicationGraphV1 => {
  const graph = capabilityGraph();
  return loadApplicationGraph({
    ...graph,
    operations: [
      ...graph.operations,
      {
        body: {
          kind: 'workflow',
          result: { kind: 'local', name: 'renamed' },
          steps: [
            {
              as: 'renamed',
              entity: 'entity.task',
              kind: 'updateEntity',
              record: { kind: 'inputField', name: 'task' },
              values: { 'field.task.title': { kind: 'inputField', name: 'title' } },
            },
            {
              arguments: {
                subject: { kind: 'inputField', name: 'title' },
                to: { kind: 'inputField', name: 'to' },
              },
              as: 'delivery',
              capability: 'capability.mail',
              kind: 'enqueueCapability',
              method: 'send',
              retry: {
                initialDelayMs: 1_000,
                jitterRatio: 0,
                maxAttempts: 2,
                maxDelayMs: 1_000,
              },
            },
          ],
        },
        effects: [
          { kind: 'databaseWrite', target: 'field.task.title' },
          { kind: 'jobEnqueue', target: 'capability.mail' },
        ],
        id: 'operation.renameAndNotifyTask',
        input: {
          fields: {
            task: { entity: 'entity.task', kind: 'entity' },
            title: { kind: 'string' },
            to: { kind: 'string' },
          },
          kind: 'record',
        },
        kind: 'operation',
        name: 'Rename and notify task',
        output: { entity: 'entity.task', kind: 'entity' },
      },
    ],
  });
};

const projectGraph = (): ApplicationGraphV1 => {
  const graph = todoGraph();
  const scoped = {
    context: 'context.project',
    kind: 'relationEqualsContext' as const,
    relation: 'relation.taskProject',
  };
  return loadApplicationGraph({
    ...graph,
    app: { ...graph.app, contexts: [...(graph.app.contexts ?? []), 'context.project'] },
    contexts: [
      ...(graph.contexts ?? []),
      {
        authorization: { kind: 'relationEqualsActor', relation: 'relation.projectOwner' },
        entity: 'builtin.project',
        id: 'context.project',
        kind: 'context',
        name: 'Project',
      },
    ],
    entities: [
      ...graph.entities,
      { id: 'builtin.project', kind: 'entity', name: 'Project', origin: 'builtin' },
    ],
    operations: graph.operations.map((operation) =>
      operation.body.kind === 'createEntity'
        ? { ...operation, body: { ...operation.body } }
        : operation,
    ),
    policies: graph.policies.map((policy) =>
      policy.target === 'entity.task'
        ? {
            ...policy,
            rules: { create: scoped, delete: scoped, read: scoped, update: scoped },
          }
        : policy,
    ),
    queries: graph.queries.map((query) =>
      query.entity === 'entity.task' ? { ...query, filter: scoped } : query,
    ),
    relations: [
      ...graph.relations,
      {
        from: {
          cardinality: 'one',
          createValue: { context: 'context.project', kind: 'activeContext' },
          entity: 'entity.task',
          name: 'project',
          required: true,
        },
        id: 'relation.taskProject',
        kind: 'relation',
        to: {
          cardinality: 'many',
          entity: 'builtin.project',
          name: 'tasks',
          required: false,
        },
      },
      {
        from: {
          cardinality: 'one',
          createValue: { kind: 'actor' },
          entity: 'builtin.project',
          name: 'owner',
          required: true,
        },
        id: 'relation.projectOwner',
        kind: 'relation',
        to: {
          cardinality: 'many',
          entity: 'builtin.user',
          name: 'projects',
          required: false,
        },
      },
    ],
  });
};

const alice: ApplicationExecutionContextV1 = {
  activeContexts: [{ contextId: 'context.team', entityId: 'entity.team', recordId: 'team-a' }],
  userId: 'user-alice',
};
const bob: ApplicationExecutionContextV1 = {
  activeContexts: [{ contextId: 'context.team', entityId: 'entity.team', recordId: 'team-b' }],
  userId: 'user-bob',
};

const taskRecord = (
  id: string,
  ownerId: string,
  title: string,
  createdAt: string,
  done = false,
): ApplicationStoredRecordV1 => ({
  entityId: 'entity.task',
  fields: {
    'field.task.createdAt': createdAt,
    'field.task.done': done,
    'field.task.id': id,
    'field.task.title': title,
  },
  relations: {
    'relation.taskOwner': ownerId,
    'relation.taskTeam': ownerId === 'user-alice' ? 'team-a' : 'team-b',
  },
});

const seed = (): readonly ApplicationStoredRecordV1[] => [
  {
    entityId: 'entity.team',
    fields: {
      'field.team.createdAt': '2026-08-25T10:00:00.000Z',
      'field.team.id': 'team-a',
      'field.team.name': 'Alice team',
    },
    relations: { 'relation.teamOwner': 'user-alice' },
  },
  {
    entityId: 'entity.team',
    fields: {
      'field.team.createdAt': '2026-08-25T11:00:00.000Z',
      'field.team.id': 'team-b',
      'field.team.name': 'Bob team',
    },
    relations: { 'relation.teamOwner': 'user-bob' },
  },
  taskRecord('task-a', 'user-alice', 'Alice task', '2026-08-26T10:00:00.000Z'),
  taskRecord('task-b', 'user-bob', 'Bob task', '2026-08-27T10:00:00.000Z'),
];

const expectHostFailure = (
  run: () => unknown,
  code: ApplicationHostError['code'],
  kind: ApplicationHostError['kind'],
): void => {
  try {
    run();
    throw new Error('Expected application host execution to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(ApplicationHostError);
    if (!(error instanceof ApplicationHostError)) throw error;
    expect({ code: error.code, kind: error.kind }).toEqual({ code, kind });
  }
};

describe('in-memory application host', () => {
  it('bounds local telemetry retention and its deterministic aggregation', () => {
    const telemetry = createApplicationTelemetryCollector({ maximumSpans: 2 });
    const span = {
      appId: 'app.todo',
      durationMs: 1,
      graphRevision: 16,
      kind: 'query' as const,
      outcome: 'success' as const,
      schemaVersion: 'oxe.application-trace-span.v1' as const,
      semanticId: 'query.myTasks',
      traceId: 'trace-1',
    };
    telemetry.emit({ ...span, spanId: 'span-1' });
    telemetry.emit({ ...span, spanId: 'span-2', traceId: 'trace-2' });
    telemetry.emit({ ...span, spanId: 'span-3', traceId: 'trace-3' });

    expect(telemetry.snapshot()).toMatchObject({
      metrics: [{ semanticId: 'query.myTasks', totalCount: 2 }],
      spans: [{ spanId: 'span-2' }, { spanId: 'span-3' }],
    });
    expect(() => createApplicationTelemetryCollector({ maximumSpans: 0 })).toThrow(
      'maximumSpans must be a positive integer.',
    );
  });

  it('emits privacy-safe spans and deterministic aggregate metrics', () => {
    const telemetry = createApplicationTelemetryCollector();
    const times = [10, 13, 20, 25];
    const host = createInMemoryApplicationHost(todoGraph(), {
      clock: () => times.shift() ?? 25,
      generateSpanId: (() => {
        let sequence = 0;
        return () => `test-span-${(sequence += 1)}`;
      })(),
      telemetry,
    });
    expect(host.query('query.myTasks', { userId: 'user-1' })).toEqual([]);
    expect(() => host.query('query.missing', { userId: 'user-1' })).toThrow(ApplicationHostError);

    const snapshot = telemetry.snapshot();
    expect(snapshot.spans).toEqual([
      {
        appId: 'app.todo',
        durationMs: 3,
        graphRevision: 16,
        kind: 'query',
        outcome: 'success',
        schemaVersion: 'oxe.application-trace-span.v1',
        semanticId: 'query.myTasks',
        spanId: 'test-span-1',
        traceId: 'test-span-1',
      },
      {
        appId: 'app.todo',
        durationMs: 5,
        failureKind: 'not-found',
        graphRevision: 16,
        kind: 'query',
        outcome: 'failure',
        schemaVersion: 'oxe.application-trace-span.v1',
        semanticId: 'query.missing',
        spanId: 'test-span-2',
        traceId: 'test-span-2',
      },
    ]);
    expect(snapshot.metrics).toEqual([
      {
        failureCount: 1,
        kind: 'query',
        maxDurationMs: 5,
        semanticId: 'query.missing',
        successCount: 0,
        totalCount: 1,
        totalDurationMs: 5,
      },
      {
        failureCount: 0,
        kind: 'query',
        maxDurationMs: 3,
        semanticId: 'query.myTasks',
        successCount: 1,
        totalCount: 1,
        totalDurationMs: 3,
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('user-1');

    const isolatedHost = createInMemoryApplicationHost(todoGraph(), {
      clock: () => {
        throw new Error('clock failed');
      },
      generateSpanId: () => {
        throw new Error('span id failed');
      },
      telemetry: {
        emit: () => {
          throw new Error('sink failed');
        },
      },
    });
    expect(isolatedHost.query('query.myTasks', { userId: 'user-1' })).toEqual([]);
  });

  it('invokes a typed provider adapter without putting provider code in the graph', () => {
    const calls: unknown[] = [];
    const host = createInMemoryApplicationHost(capabilityGraph(), {
      capabilityAdapters: {
        'capability.mail': {
          invoke: (invocation, context) => {
            calls.push({ context, invocation });
            return { deliveryId: 'delivery-1' };
          },
        },
      },
    });

    expect(
      host.execute('operation.sendMail', { subject: 'Welcome', to: 'person@example.com' }, alice),
    ).toEqual({ deliveryId: 'delivery-1' });
    expect(calls).toEqual([
      {
        context: alice,
        invocation: {
          capabilityId: 'capability.mail',
          contract: 'oxe.capability.mail',
          input: { subject: 'Welcome', to: 'person@example.com' },
          method: 'send',
          version: '1',
        },
      },
    ]);
  });

  it('validates refined inputs, explicit null, lists, and typed capability outcomes', () => {
    const host = createInMemoryApplicationHost(resultCapabilityGraph(), {
      capabilityAdapters: {
        'capability.mail': {
          invoke: () => ({ outcome: 'rejected', value: { reason: 'blocked' } }),
        },
      },
    });
    expect(
      host.execute(
        'operation.sendMail',
        { budget: '12.30', cc: null, tags: ['welcome'], to: 'person@example.com' },
        alice,
      ),
    ).toEqual({ outcome: 'rejected', value: { reason: 'blocked' } });
    expect(() =>
      host.execute(
        'operation.sendMail',
        { budget: '12.345', cc: null, tags: ['welcome'], to: 'invalid' },
        alice,
      ),
    ).toThrow('input.budget has an invalid value.');
  });

  it('commits data and a durable capability job atomically, then retries delivery', () => {
    const calls: unknown[] = [];
    let jobNow = Date.parse('2026-08-30T12:00:00.000Z');
    const host = createInMemoryApplicationHost(queuedCapabilityGraph(), {
      capabilityAdapters: {
        'capability.mail': {
          idempotency: 'jobId',
          invoke: (invocation) => {
            calls.push(invocation);
            if (calls.length === 1) throw new Error('temporary provider failure');
            return { deliveryId: 'delivery-queued' };
          },
        },
      },
      generateJobId: () => 'job-mail-1',
      jobClock: () => jobNow,
      records: seed(),
    });
    const task = host.query('query.myTasks', alice)[0]!;

    expect(
      host.execute(
        'operation.renameAndNotifyTask',
        { task, title: 'Queued title', to: 'person@example.com' },
        alice,
      ),
    ).toMatchObject({ id: 'task-a', title: 'Queued title' });
    expect(calls).toEqual([]);
    expect(host.snapshot().jobs).toEqual([
      {
        attempts: 0,
        availableAt: '2026-08-30T12:00:00.000Z',
        capabilityId: 'capability.mail',
        createdAt: '2026-08-30T12:00:00.000Z',
        id: 'job-mail-1',
        maxAttempts: 2,
        method: 'send',
        status: 'pending',
      },
    ]);

    expect(host.runJobs()).toEqual({ claimed: 1, completed: 0, failed: 0, pendingRetry: 1 });
    expect(host.runJobs()).toEqual({ claimed: 0, completed: 0, failed: 0, pendingRetry: 0 });
    jobNow += 1_000;
    expect(host.runJobs()).toEqual({ claimed: 1, completed: 1, failed: 0, pendingRetry: 0 });
    expect(calls).toEqual([
      expect.objectContaining({ delivery: { attempt: 1, jobId: 'job-mail-1' } }),
      expect.objectContaining({ delivery: { attempt: 2, jobId: 'job-mail-1' } }),
    ]);
    expect(JSON.stringify(host.snapshot())).not.toContain('person@example.com');
  });

  it('dead-letters exhausted jobs and permits explicit replay without exposing payloads', () => {
    let jobNow = Date.parse('2026-08-30T12:00:00.000Z');
    let succeeds = false;
    const host = createInMemoryApplicationHost(queuedCapabilityGraph(), {
      capabilityAdapters: {
        'capability.mail': {
          idempotency: 'jobId',
          invoke: () => {
            if (!succeeds) throw new Error('provider unavailable');
            return { deliveryId: 'delivery-after-replay' };
          },
        },
      },
      generateJobId: () => 'job-dead-letter',
      jobClock: () => jobNow,
      records: seed(),
    });
    const task = host.query('query.myTasks', alice)[0]!;
    host.execute(
      'operation.renameAndNotifyTask',
      { task, title: 'Dead letter title', to: 'private@example.com' },
      alice,
    );

    expect(host.runJobs()).toMatchObject({ pendingRetry: 1 });
    jobNow += 1_000;
    expect(host.runJobs()).toEqual({ claimed: 1, completed: 0, failed: 1, pendingRetry: 0 });
    expect(host.listJobs({ status: 'deadLetter' })).toEqual([
      expect.objectContaining({
        attempts: 2,
        id: 'job-dead-letter',
        lastErrorKind: 'delivery',
        status: 'deadLetter',
      }),
    ]);
    expect(JSON.stringify(host.listJobs())).not.toContain('private@example.com');

    succeeds = true;
    expect(host.replayJob('job-dead-letter', { maxAttempts: 3 })).toMatchObject({
      attempts: 0,
      maxAttempts: 3,
      status: 'pending',
    });
    expect(host.runJobs()).toEqual({ claimed: 1, completed: 1, failed: 0, pendingRetry: 0 });
  });

  it('executes typed workflow locals atomically with one semantic revision', () => {
    const host = createInMemoryApplicationHost(workflowGraph(), { records: seed() });
    const task = host.query('query.myTasks', alice)[0]!;

    expect(
      host.execute(
        'operation.renameAndToggleTask',
        { task: { ...task, done: true, title: 'Spoofed' }, title: 'Workflow title' },
        alice,
      ),
    ).toMatchObject({ done: true, id: 'task-a', title: 'Workflow title' });
    expect(host.snapshot().revision).toBe(1);
  });

  it('restores records, sequences, and revision when a workflow step fails', () => {
    const host = createInMemoryApplicationHost(workflowGraph(true), { records: seed() });
    const before = host.snapshot();
    const task = host.query('query.myTasks', alice)[0]!;

    expectHostFailure(
      () => host.execute('operation.rollbackWorkflow', { task }, alice),
      'OXE3404',
      'not-found',
    );
    expect(host.snapshot()).toEqual(before);
  });

  it('executes Todo queries and operations from semantic bodies', () => {
    const host = createInMemoryApplicationHost(todoGraph(), {
      now: () => '2026-08-28T10:00:00.000Z',
      records: seed(),
    });

    expect(host.query('query.myTasks', alice)).toEqual([
      {
        createdAt: '2026-08-26T10:00:00.000Z',
        done: false,
        id: 'task-a',
        title: 'Alice task',
      },
    ]);
    expect(host.execute('operation.createTask', { title: 'New task' }, alice)).toEqual({
      createdAt: '2026-08-28T10:00:00.000Z',
      done: false,
      id: 'task-3',
      title: 'New task',
    });
    expect(host.query('query.myTasks', alice).map((task) => task.id)).toEqual(['task-3', 'task-a']);

    const spoofed = {
      createdAt: '1900-01-01T00:00:00.000Z',
      done: true,
      id: 'task-a',
      title: 'Forged title',
    };
    expect(host.execute('operation.toggleTask', { task: spoofed }, alice)).toEqual({
      createdAt: '2026-08-26T10:00:00.000Z',
      done: true,
      id: 'task-a',
      title: 'Alice task',
    });
    expect(
      host.execute('operation.renameTask', { task: spoofed, title: 'Renamed task' }, alice),
    ).toMatchObject({ done: true, id: 'task-a', title: 'Renamed task' });
    const created = host.query('query.myTasks', alice).find((task) => task.id === 'task-3');
    if (!created) throw new Error('Missing created task.');
    expect(host.execute('operation.deleteTask', { task: created }, alice)).toMatchObject({
      id: 'task-3',
      title: 'New task',
    });
    expect(host.query('query.myTasks', alice)).toEqual([
      expect.objectContaining({ id: 'task-a', title: 'Renamed task' }),
    ]);
    expect(host.snapshot()).toMatchObject({ revision: 4 });
  });

  it('enforces authentication and relation ownership without mutating on failure', () => {
    const host = createInMemoryApplicationHost(todoGraph(), { records: seed() });

    expectHostFailure(() => host.query('query.myTasks', {}), 'OXE3402', 'unauthorized');
    const aliceTask = host.query('query.myTasks', alice)[0];
    if (!aliceTask) throw new Error('Missing seeded Alice task.');
    expectHostFailure(
      () => host.execute('operation.toggleTask', { task: aliceTask }, bob),
      'OXE3403',
      'forbidden',
    );
    expectHostFailure(
      () =>
        host.execute(
          'operation.renameTask',
          { task: aliceTask, title: 'Bob cannot rename this' },
          bob,
        ),
      'OXE3403',
      'forbidden',
    );
    expectHostFailure(
      () => host.execute('operation.deleteTask', { task: aliceTask }, bob),
      'OXE3403',
      'forbidden',
    );
    expectHostFailure(
      () => host.execute('operation.createTask', { title: '' }, alice),
      'OXE3401',
      'validation',
    );
    expect(host.snapshot().revision).toBe(0);
    expect(host.query('query.myTasks', bob).map((task) => task.id)).toEqual(['task-b']);

    const emptyHost = createInMemoryApplicationHost(todoGraph());
    expectHostFailure(() => emptyHost.query('query.myTasks', {}), 'OXE3402', 'unauthorized');
    expectHostFailure(
      () =>
        createInMemoryApplicationHost(todoGraph(), {
          records: [{ ...seed()[0]!, relations: {} }],
        }),
      'OXE3401',
      'validation',
    );
  });

  it('returns detached deterministic snapshots', () => {
    const host = createInMemoryApplicationHost(todoGraph(), { records: seed() });
    const first = host.snapshot();
    const second = host.snapshot();

    expect(first).toEqual(second);
    expect(first.records.map((record) => record.entityId)).toEqual([
      'entity.task',
      'entity.task',
      'entity.team',
      'entity.team',
    ]);
    expect(first.records[0]).not.toBe(second.records[0]);
  });

  it('applies graph-declared scalar query predicates before projection', () => {
    const graph = todoGraph();
    const filtered = loadApplicationGraph({
      ...graph,
      queries: graph.queries.map((query) =>
        query.id === 'query.myTasks'
          ? { ...query, where: [{ equals: false, field: 'field.task.done' }] }
          : query,
      ),
    });
    const host = createInMemoryApplicationHost(filtered, {
      records: [
        ...seed(),
        taskRecord(
          'task-complete',
          'user-alice',
          'Completed task',
          '2026-08-28T09:00:00.000Z',
          true,
        ),
      ],
    });

    expect(host.query('query.myTasks', alice).map((task) => task.id)).toEqual(['task-a']);
  });

  it('binds policies and create defaults to a declared active project context', () => {
    const records = seed().map((record) =>
      record.entityId === 'entity.task'
        ? {
            ...record,
            relations: {
              ...record.relations,
              'relation.taskProject':
                record.fields['field.task.id'] === 'task-a' ? 'project-a' : 'project-b',
            },
          }
        : record,
    );
    const host = createInMemoryApplicationHost(projectGraph(), {
      now: () => '2026-08-28T10:00:00.000Z',
      records,
    });
    const projectA = {
      activeContexts: [
        { contextId: 'context.team', entityId: 'entity.team', recordId: 'team-a' },
        { contextId: 'context.project', entityId: 'builtin.project', recordId: 'project-a' },
      ],
      userId: 'user-alice',
    } as const;

    expect(host.query('query.myTasks', projectA).map((task) => task.id)).toEqual(['task-a']);
    expect(host.execute('operation.createTask', { title: 'Project task' }, projectA)).toMatchObject(
      {
        title: 'Project task',
      },
    );
    expect(
      host.snapshot().records.find((record) => record.fields['field.task.id'] === 'task-3')
        ?.relations?.['relation.taskProject'],
    ).toBe('project-a');
    expectHostFailure(
      () => host.query('query.myTasks', { userId: 'user-alice' }),
      'OXE3403',
      'forbidden',
    );
    expectHostFailure(
      () =>
        host.query('query.myTasks', {
          activeContexts: [
            {
              contextId: 'context.organization',
              entityId: 'builtin.organization',
              recordId: 'org-a',
            },
          ],
          userId: 'user-alice',
        }),
      'OXE3401',
      'validation',
    );
  });
});
