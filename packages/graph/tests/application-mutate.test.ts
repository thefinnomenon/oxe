import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  loadApplicationGraph,
  mutateApplicationGraph,
  projectCompactApplicationGraph,
  validateApplicationGraph,
  validateApplicationMutationBatch,
  type ApplicationGraphV1,
  type ApplicationMutationBatchV1,
  type ApplicationViewElementV1,
} from '../src/index.js';

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

const findElement = (
  element: ApplicationViewElementV1,
  id: string,
): ApplicationViewElementV1 | undefined => {
  if (element.id === id) return element;
  if (element.kind === 'repeat') return findElement(element.template, id);
  for (const child of element.children ?? []) {
    const result = findElement(child, id);
    if (result) return result;
  }
  return undefined;
};

describe('atomic application graph mutations', () => {
  it('validates unknown agent mutation payloads before creating a draft', () => {
    expect(
      validateApplicationMutationBatch({
        base: '12',
        ops: [
          {
            entity: 'entity.task',
            extra: true,
            name: 'priority',
            op: 'field.add',
            type: { enum: ['low', 2] },
          },
        ],
      }),
    ).toEqual([
      {
        code: 'OXE3203',
        message: 'Mutation base must be a nonnegative integer revision.',
        path: '$.base',
      },
      {
        code: 'OXE3203',
        message: 'Unknown field.add property "extra".',
        opIndex: 0,
        path: '$.ops[0].extra',
      },
      {
        code: 'OXE3203',
        message: 'Enum values must be strings.',
        opIndex: 0,
        path: '$.ops[0].type.enum[1]',
      },
    ]);
  });

  it('adds Task.priority to data, create form, operation, query, and list in one revision', () => {
    const current = todoGraph();
    const result = mutateApplicationGraph(current, priorityBatch);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);

    expect(current.revision).toBe(16);
    expect(current.fields.some((field) => field.id === 'field.task.priority')).toBe(false);
    expect(result.revision).toBe(17);
    expect(result.graph.revision).toBe(17);
    expect(validateApplicationGraph(result.graph)).toEqual([]);

    expect(result.graph.fields.find((field) => field.id === 'field.task.priority')).toEqual({
      default: { kind: 'literal', value: 'normal' },
      entity: 'entity.task',
      id: 'field.task.priority',
      kind: 'field',
      name: 'priority',
      required: true,
      valueType: { kind: 'enum', values: ['low', 'normal', 'high'] },
    });
    expect(result.graph.entities.find((entity) => entity.id === 'entity.task')?.fields).toContain(
      'field.task.priority',
    );

    const view = result.graph.views.find((candidate) => candidate.id === 'view.tasks');
    const form = view ? findElement(view.tree, 'element.createTaskForm') : undefined;
    const list = view ? findElement(view.tree, 'element.taskList') : undefined;
    expect(form?.kind === 'component' ? form.fields : undefined).toEqual(['field.task.priority']);
    expect(list?.kind === 'repeat' ? list.display : undefined).toEqual(['field.task.priority']);

    const createTask = result.graph.operations.find(
      (operation) => operation.id === 'operation.createTask',
    );
    expect(createTask?.input.fields.priority).toEqual({
      kind: 'enum',
      values: ['low', 'normal', 'high'],
    });
    expect(
      createTask?.body.kind === 'createEntity' ? createTask.body.values : undefined,
    ).toMatchObject({
      'field.task.priority': { kind: 'inputField', name: 'priority' },
    });
    expect(result.graph.queries.find((query) => query.id === 'query.myTasks')?.select).toContain(
      'field.task.priority',
    );

    expect(result.changes.map((change) => change.kind)).toEqual([
      'field.added',
      'form.field.added',
      'list.display.added',
    ]);
    expect(result.summary).toBe(`r17 committed

+ Task.priority: enum(low,normal,high)=normal
~ TasksPage.element.createTaskForm added priority
~ TasksPage.element.taskList displays priority

checked graph types
`);
    expect(projectCompactApplicationGraph(result.graph)).toContain(
      'F3 priority: enum(low,normal,high) = "normal"',
    );
    expect(projectCompactApplicationGraph(result.graph)).toContain('Form1 create E1 [F1 F3]');
    expect(projectCompactApplicationGraph(result.graph)).toContain('display F3');
  });

  it('rejects a stale base revision without creating a draft revision', () => {
    const current = todoGraph();
    const result = mutateApplicationGraph(current, { ...priorityBatch, base: 11 });

    expect(result).toEqual({
      diagnostics: [
        {
          code: 'OXE3201',
          message: 'Mutation base r11 does not match current revision r16.',
          path: '$.base',
        },
      ],
      graph: current,
      ok: false,
      revision: 16,
    });
    expect(result.graph).toBe(current);
  });

  it('rolls back earlier operations when a later operation fails', () => {
    const current = todoGraph();
    const fieldAdd = priorityBatch.ops[0];
    if (!fieldAdd) throw new Error('Priority batch is missing its field operation.');
    const result = mutateApplicationGraph(current, {
      ...priorityBatch,
      ops: [
        fieldAdd,
        {
          field: '$priority',
          list: 'element.missing',
          op: 'list.display.add',
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the batch to fail.');
    expect(result.graph).toBe(current);
    expect(result.revision).toBe(16);
    expect(result.graph.fields.some((field) => field.id === 'field.task.priority')).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        code: 'OXE3202',
        message: 'List "element.missing" does not exist.',
        opIndex: 1,
        path: '$.ops[1].list',
      },
    ]);
  });

  it('rejects forward aliases and invalid enum defaults precisely', () => {
    const current = todoGraph();
    const forwardAlias = mutateApplicationGraph(current, {
      base: 16,
      ops: [
        {
          field: '$priority',
          list: 'element.taskList',
          op: 'list.display.add',
        },
      ],
    });
    const invalidDefault = mutateApplicationGraph(current, {
      base: 16,
      ops: [
        {
          default: 'urgent',
          entity: 'entity.task',
          name: 'priority',
          op: 'field.add',
          type: { enum: ['low', 'normal', 'high'] },
        },
      ],
    });

    expect(forwardAlias.ok ? [] : forwardAlias.diagnostics).toEqual([
      {
        code: 'OXE3202',
        message: 'Batch alias "$priority" has not been created by an earlier operation.',
        opIndex: 0,
        path: '$.ops[0].field',
      },
    ]);
    expect(invalidDefault.ok ? [] : invalidDefault.diagnostics).toEqual([
      {
        code: 'OXE3203',
        message: 'Default "urgent" is not one of the declared enum values.',
        opIndex: 0,
        path: '$.ops[0].default',
      },
    ]);
  });

  it('rejects an incomplete proposed revision after applying the private draft', () => {
    const current = todoGraph();
    const result = mutateApplicationGraph(current, {
      base: 16,
      ops: [
        {
          entity: 'entity.task',
          name: 'priority',
          op: 'field.add',
          type: { enum: ['low', 'normal', 'high'] },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the proposed revision to fail validation.');
    expect(result.graph).toBe(current);
    expect(result.diagnostics).toEqual([
      {
        code: 'OXE3204',
        message: 'The complete proposed revision failed application graph validation.',
        path: '$.ops',
      },
    ]);
    expect(result.graphDiagnostics).toContainEqual({
      code: 'OXE3105',
      message:
        'Create operation "operation.createTask" does not provide required field "field.task.priority".',
      path: '$.operations[0].body.values',
      semanticId: 'operation.createTask',
    });
  });

  it('produces deterministic graphs, changes, summaries, and projections', () => {
    const first = mutateApplicationGraph(todoGraph(), priorityBatch);
    const second = mutateApplicationGraph(todoGraph(), priorityBatch);

    expect(first).toEqual(second);
    if (!first.ok || !second.ok) throw new Error('Expected both batches to commit.');
    expect(projectCompactApplicationGraph(first.graph)).toBe(
      projectCompactApplicationGraph(second.graph),
    );
  });

  it('atomically adds and replaces typed semantic nodes and the app definition', () => {
    const current = todoGraph();
    const tasks = current.queries.find((query) => query.id === 'query.myTasks');
    if (!tasks) throw new Error('Todo fixture is missing its task query.');
    const result = mutateApplicationGraph(current, {
      base: current.revision,
      ops: [
        {
          node: {
            id: 'invariant.taskCacheIsAdvisory',
            kind: 'invariant',
            statement: 'Authorization is enforced before cached task data is returned.',
          },
          op: 'semantic.add',
        },
        {
          node: { ...tasks, cache: { kind: 'no-store' } },
          op: 'semantic.replace',
        },
        {
          app: { ...current.app, name: 'TinyTodo Semantic' },
          op: 'app.replace',
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.revision).toBe(17);
    expect(result.changes).toEqual([
      {
        kind: 'semantic.added',
        nodeId: 'invariant.taskCacheIsAdvisory',
        nodeKind: 'invariant',
      },
      { kind: 'semantic.replaced', nodeId: 'query.myTasks', nodeKind: 'query' },
      { appId: 'app.todo', kind: 'app.replaced' },
    ]);
    expect(result.graph.queries.find((query) => query.id === tasks.id)?.cache).toEqual({
      kind: 'no-store',
    });
    expect(result.graph.app.name).toBe('TinyTodo Semantic');

    const rolledBack = mutateApplicationGraph(current, {
      base: current.revision,
      ops: [
        { node: { ...tasks, cache: { kind: 'no-store' } }, op: 'semantic.replace' },
        {
          node: {
            entity: 'entity.missing',
            id: 'field.missing.name',
            kind: 'field',
            name: 'name',
            required: true,
            valueType: { kind: 'string' },
          },
          op: 'semantic.add',
        },
      ],
    });
    expect(rolledBack.ok).toBe(false);
    expect(rolledBack.graph).toBe(current);
    expect(current.queries.find((query) => query.id === tasks.id)?.cache).toEqual(tasks.cache);
  });
});
