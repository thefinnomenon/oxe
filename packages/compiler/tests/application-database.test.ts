import { readFileSync } from 'node:fs';

import {
  loadApplicationGraph,
  mutateApplicationGraph,
  type ApplicationGraphV1,
  type ApplicationMutationBatchV1,
} from '@oxe/graph';
import { describe, expect, it } from 'vitest';

import {
  ApplicationDatabaseProjectionError,
  lowerApplicationGraphToDatabaseSchema,
  planApplicationDatabaseMigration,
  serializeApplicationDatabaseProjection,
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
    { field: '$priority', form: 'element.createTaskForm', op: 'form.field.add' },
    { field: '$priority', list: 'element.taskList', op: 'list.display.add' },
  ],
};

const priorityGraph = (): ApplicationGraphV1 => {
  const result = mutateApplicationGraph(todoGraph(), priorityBatch);
  if (!result.ok) throw new Error(result.diagnostics[0]?.message);
  return result.graph;
};

const expectProjectionFailure = (
  run: () => unknown,
  code: ApplicationDatabaseProjectionError['diagnostics'][number]['code'],
  semanticId: string,
): ApplicationDatabaseProjectionError => {
  try {
    run();
    throw new Error('Expected database projection to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(ApplicationDatabaseProjectionError);
    if (!(error instanceof ApplicationDatabaseProjectionError)) throw error;
    expect(error.diagnostics[0]).toMatchObject({ code, semanticId });
    return error;
  }
};

describe('application database projection', () => {
  it('lowers Todo and Team storage without inventing User data', () => {
    const projection = lowerApplicationGraphToDatabaseSchema(todoGraph());

    expect(projection).toMatchObject({
      appId: 'app.todo',
      revision: 16,
      schemaVersion: 'oxe.application-database-schema.v1',
    });
    expect(projection.externalEntities).toEqual([
      {
        entityId: 'builtin.user',
        name: 'User',
        sourcePath: '$.entities[0]',
      },
    ]);
    expect(projection.tables.map((table) => table.entityId)).toEqual([
      'entity.task',
      'entity.team',
      'entity.teamMembership',
    ]);
    expect(
      projection.tables
        .find((table) => table.entityId === 'entity.task')
        ?.columns.map((column) => column.fieldId),
    ).toEqual(['field.task.createdAt', 'field.task.done', 'field.task.id', 'field.task.title']);
    expect(
      projection.tables
        .find((table) => table.entityId === 'entity.team')
        ?.columns.map((column) => column.fieldId),
    ).toEqual(['field.team.createdAt', 'field.team.id', 'field.team.name']);
    expect(projection.relations.map((relation) => relation.relationId)).toEqual([
      'relation.membershipMember',
      'relation.membershipTeam',
      'relation.taskOwner',
      'relation.taskTeam',
      'relation.teamOwner',
    ]);
    expect(projection.uniques).toEqual([
      {
        entityId: 'entity.teamMembership',
        keys: ['relation.membershipMember', 'relation.membershipTeam'],
        sourcePath: '$.uniques[0]',
        constraintId: 'unique.membershipTeamMember',
      },
    ]);
  });

  it('plans the Todo priority revision as one safe additive column operation', () => {
    const plan = planApplicationDatabaseMigration(todoGraph(), priorityGraph());

    expect(plan).toEqual({
      appId: 'app.todo',
      fromRevision: 16,
      operations: [
        {
          column: {
            default: 'normal',
            fieldId: 'field.task.priority',
            name: 'priority',
            nullable: false,
            sourcePath: '$.fields[9]',
            type: { kind: 'enum', values: ['low', 'normal', 'high'] },
          },
          entityId: 'entity.task',
          operationId: 'column.add:field.task.priority',
          type: 'column.add',
        },
      ],
      schemaVersion: 'oxe.application-database-migration.v1',
      toRevision: 17,
    });
  });

  it('is deterministic when semantically unordered graph collections are reordered', () => {
    const target = priorityGraph();
    const reordered: ApplicationGraphV1 = {
      ...target,
      entities: [...target.entities].reverse().map((entity) => ({
        ...entity,
        ...(entity.fields ? { fields: [...entity.fields].reverse() } : {}),
      })),
      features: [...target.features].reverse(),
      fields: [...target.fields].reverse(),
      operations: [...target.operations].reverse(),
      policies: [...target.policies].reverse(),
      queries: [...target.queries].reverse(),
      relations: [...target.relations].reverse(),
      routes: [...target.routes].reverse(),
      views: [...target.views].reverse(),
    };

    expect(
      serializeApplicationDatabaseProjection(lowerApplicationGraphToDatabaseSchema(reordered)),
    ).toBe(serializeApplicationDatabaseProjection(lowerApplicationGraphToDatabaseSchema(target)));
    expect(
      serializeApplicationDatabaseProjection(
        planApplicationDatabaseMigration(todoGraph(), reordered),
      ),
    ).toBe(
      serializeApplicationDatabaseProjection(planApplicationDatabaseMigration(todoGraph(), target)),
    );
  });

  it('rejects a required additive column without a backfill default or generator', () => {
    const target = priorityGraph();
    const unsafe: ApplicationGraphV1 = {
      ...target,
      fields: target.fields.map((field) => {
        if (field.id !== 'field.task.priority') return field;
        return {
          entity: field.entity,
          id: field.id,
          kind: field.kind,
          name: field.name,
          ...(field.origin === undefined ? {} : { origin: field.origin }),
          required: field.required,
          ...(field.validation === undefined ? {} : { validation: field.validation }),
          valueType: field.valueType,
        };
      }),
    };

    const error = expectProjectionFailure(
      () => planApplicationDatabaseMigration(todoGraph(), unsafe),
      'OXE2304',
      'field.task.priority',
    );
    expect(error.diagnostics[0]?.message).toContain('needs a default or generation strategy');
  });

  it('rejects destructive removal and stored-contract changes', () => {
    const removed = { ...todoGraph(), revision: 18 };
    const removalError = expectProjectionFailure(
      () => planApplicationDatabaseMigration(priorityGraph(), removed),
      'OXE2303',
      'field.task.priority',
    );
    expect(removalError.diagnostics[0]?.message).toContain('destructive');

    const current = todoGraph();
    const changed: ApplicationGraphV1 = {
      ...current,
      fields: current.fields.map((field) =>
        field.id === 'field.task.done'
          ? { ...field, default: { kind: 'literal', value: true } }
          : field,
      ),
      revision: 17,
    };
    const changeError = expectProjectionFailure(
      () => planApplicationDatabaseMigration(current, changed),
      'OXE2304',
      'field.task.done',
    );
    expect(changeError.diagnostics[0]?.message).toContain('stored contract');
  });

  it('rejects unrelated or non-forward revisions before emitting a plan', () => {
    const current = todoGraph();
    const unrelated = loadApplicationGraph(
      JSON.parse(JSON.stringify(priorityGraph()).replaceAll('app.todo', 'app.other')) as unknown,
    );
    expectProjectionFailure(
      () => planApplicationDatabaseMigration(current, unrelated),
      'OXE2302',
      'app.other',
    );
    expectProjectionFailure(
      () => planApplicationDatabaseMigration(current, { ...current, revision: 16 }),
      'OXE2302',
      'app.todo',
    );
  });
});
