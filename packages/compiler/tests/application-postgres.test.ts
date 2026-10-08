import { readFileSync } from 'node:fs';

import {
  loadApplicationGraph,
  mutateApplicationGraph,
  type ApplicationGraphV1,
  type ApplicationMutationBatchV1,
} from '@oxe/graph';
import { describe, expect, it } from 'vitest';

import {
  ApplicationPostgresProjectionError,
  compileApplicationPostgresMigration,
  compileApplicationPostgresSchema,
  generateApplicationPostgresInfrastructureSql,
  generateApplicationPostgresSchemaSql,
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

const numberGraph = (): ApplicationGraphV1 => {
  const graph = todoGraph();
  return loadApplicationGraph({
    ...graph,
    entities: graph.entities.map((entity) =>
      entity.id === 'entity.task'
        ? { ...entity, fields: [...(entity.fields ?? []), 'field.task.estimate'] }
        : entity,
    ),
    fields: [
      ...graph.fields,
      {
        default: { kind: 'literal', value: 1.5 },
        entity: 'entity.task',
        id: 'field.task.estimate',
        kind: 'field',
        name: 'estimate',
        required: true,
        valueType: { kind: 'number' },
      },
    ],
  });
};

const refinedStorageGraph = (): ApplicationGraphV1 => {
  const graph = todoGraph();
  const fields = [
    {
      default: { kind: 'literal', value: 1 },
      id: 'field.task.attempts',
      name: 'attempts',
      required: true,
      valueType: { kind: 'integer', maximum: 5, minimum: 1 },
    },
    {
      default: { kind: 'literal', value: '0.00' },
      id: 'field.task.price',
      name: 'price',
      required: true,
      valueType: { kind: 'decimal', precision: 12, scale: 2 },
    },
    {
      id: 'field.task.due',
      name: 'due',
      required: false,
      valueType: { kind: 'optional', value: { kind: 'date' } },
    },
    {
      id: 'field.task.tags',
      name: 'tags',
      required: false,
      valueType: { items: { kind: 'string' }, kind: 'list', maximumItems: 8 },
    },
  ] as const;
  return loadApplicationGraph({
    ...graph,
    entities: graph.entities.map((entity) =>
      entity.id === 'entity.task'
        ? { ...entity, fields: [...(entity.fields ?? []), ...fields.map((field) => field.id)] }
        : entity,
    ),
    fields: [
      ...graph.fields,
      ...fields.map((field) => ({ ...field, entity: 'entity.task', kind: 'field' as const })),
    ],
  });
};

const queuedGraph = (): ApplicationGraphV1 => {
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
            input: { fields: { subject: { kind: 'string' } }, kind: 'record' },
            output: { fields: { deliveryId: { kind: 'string' } }, kind: 'record' },
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
              arguments: { subject: { kind: 'inputField', name: 'title' } },
              as: 'notification',
              capability: 'capability.mail',
              kind: 'enqueueCapability',
              method: 'send',
              retry: { maxAttempts: 3 },
            },
          ],
        },
        effects: [
          { kind: 'databaseWrite', target: 'field.task.title' },
          { kind: 'jobEnqueue', target: 'capability.mail' },
        ],
        id: 'operation.renameAndNotify',
        input: {
          fields: {
            task: { entity: 'entity.task', kind: 'entity' },
            title: { kind: 'string' },
          },
          kind: 'record',
        },
        kind: 'operation',
        name: 'Rename and notify',
        output: { entity: 'entity.task', kind: 'entity' },
      },
    ],
    revision: 17,
  });
};

describe('application PostgreSQL target', () => {
  it('projects refined, optional, and collection storage without lossy scalar coercion', () => {
    const schema = compileApplicationPostgresSchema(refinedStorageGraph());
    const task = schema.tables.find((table) => table.entityId === 'entity.task');
    expect(task?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: 'field.task.attempts', sqlType: 'BIGINT' }),
        expect.objectContaining({ fieldId: 'field.task.price', sqlType: 'NUMERIC(12,2)' }),
        expect.objectContaining({ fieldId: 'field.task.due', nullable: true, sqlType: 'DATE' }),
        expect.objectContaining({ fieldId: 'field.task.tags', nullable: true, sqlType: 'JSONB' }),
      ]),
    );
    const sql = generateApplicationPostgresSchemaSql(schema);
    expect(sql).toContain('NUMERIC(12,2)');
    expect(sql).toContain('CHECK ("attempts" >= 1 AND "attempts" <= 5)');
  });

  it('lowers Todo into stable tables, constraints, and an external user reference', () => {
    const schema = compileApplicationPostgresSchema(todoGraph());

    expect(schema).toMatchObject({
      appId: 'app.todo',
      revision: 16,
      schemaName: 'oxe_todo',
      schemaVersion: 'oxe.application-postgres-schema.v1',
    });
    expect(schema.externalReferences.map((reference) => reference.relationId)).toEqual([
      'relation.membershipMember',
      'relation.taskOwner',
      'relation.teamOwner',
    ]);
    expect(schema.tables[0]).toMatchObject({
      entityId: 'entity.task',
      physicalName: 'task',
      primaryKey: {
        columnName: 'id',
        constraintName: 'pk_task',
        fieldId: 'field.task.id',
      },
    });
    expect(schema.tables[0]?.columns.map((column) => column.physicalName)).toEqual([
      'created_at',
      'done',
      'id',
      'title',
      'owner_id',
      'team_id',
    ]);
    expect(schema.tables.find((table) => table.entityId === 'entity.team')).toMatchObject({
      physicalName: 'team',
      primaryKey: { fieldId: 'field.team.id' },
    });
    expect(
      schema.tables.find((table) => table.entityId === 'entity.teamMembership')?.uniques,
    ).toEqual([
      {
        columnNames: ['membership_member_id', 'membership_team_id'],
        constraintId: 'unique.membershipTeamMember',
        constraintName: 'uq_membership_team_member',
      },
    ]);
    const sql = generateApplicationPostgresSchemaSql(schema);
    expect(sql).toContain('CREATE TABLE "oxe_todo"."task"');
    expect(sql).toContain('CREATE TABLE "oxe_todo"."__oxe_outbox_jobs"');
    expect(sql).toContain('CREATE TABLE "oxe_todo"."team"');
    expect(sql).toContain('"team_id" TEXT');
    expect(sql).toContain(
      'CONSTRAINT "uq_membership_team_member" UNIQUE ("membership_member_id", "membership_team_id")',
    );
  });

  it('emits the priority revision as deterministic forward-only PostgreSQL SQL', () => {
    expect(compileApplicationPostgresMigration(todoGraph(), priorityGraph())).toEqual({
      appId: 'app.todo',
      fromRevision: 16,
      migrationId: 'r16-r17',
      schemaVersion: 'oxe.application-postgres-migration.v1',
      sql: `ALTER TABLE "oxe_todo"."task" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "oxe_todo"."task" ADD CONSTRAINT "ck_priority_enum" CHECK ("priority" IN ('low', 'normal', 'high'));
`,
      toRevision: 17,
    });
  });

  it('repairs framework infrastructure independently of an existing graph ledger head', () => {
    const sql = generateApplicationPostgresInfrastructureSql(todoGraph());

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "oxe_todo"."__oxe_outbox_jobs"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "ix_oxe_outbox_jobs_claim"');
  });

  it('adds idempotent outbox infrastructure when queued delivery first appears', () => {
    const migration = compileApplicationPostgresMigration(todoGraph(), queuedGraph());
    expect(migration.sql).toContain('CREATE TABLE IF NOT EXISTS "oxe_todo"."__oxe_outbox_jobs"');
    expect(migration.sql).toContain('"execution_context" JSONB NOT NULL');
    expect(migration.sql).toContain('"initial_delay_ms" DOUBLE PRECISION NOT NULL');
    expect(migration.sql).toContain('"jitter_ratio" DOUBLE PRECISION NOT NULL');
    expect(migration.sql).toContain('ix_oxe_outbox_jobs_claim');
  });

  it('projects numeric application fields to numeric PostgreSQL columns', () => {
    const table = compileApplicationPostgresSchema(numberGraph()).tables.find(
      (candidate) => candidate.entityId === 'entity.task',
    );
    expect(table?.columns.find((column) => column.fieldId === 'field.task.estimate')).toMatchObject(
      {
        defaultSql: '1.5',
        sqlType: 'DOUBLE PRECISION',
      },
    );
  });

  it('derives physical names from semantic ids rather than renameable labels', () => {
    const graph = todoGraph();
    const renamed: ApplicationGraphV1 = {
      ...graph,
      entities: graph.entities.map((entity) =>
        entity.id === 'entity.task' ? { ...entity, name: 'WorkItem' } : entity,
      ),
      fields: graph.fields.map((field) =>
        field.id === 'field.task.title' ? { ...field, name: 'description' } : field,
      ),
    };

    expect(compileApplicationPostgresSchema(renamed)).toEqual(
      compileApplicationPostgresSchema(graph),
    );
  });

  it('is deterministic across unordered application collection order', () => {
    const graph = priorityGraph();
    const reordered: ApplicationGraphV1 = {
      ...graph,
      entities: [...graph.entities].reverse(),
      fields: [...graph.fields].reverse(),
      relations: [...graph.relations].reverse(),
    };

    expect(compileApplicationPostgresSchema(reordered)).toEqual(
      compileApplicationPostgresSchema(graph),
    );
  });

  it('rejects many-to-many storage until a join-table strategy is explicit', () => {
    const graph = todoGraph();
    const unsupported: ApplicationGraphV1 = {
      ...graph,
      relations: graph.relations.map((relation) =>
        relation.id === 'relation.taskOwner'
          ? {
              ...relation,
              from: {
                cardinality: 'many',
                entity: relation.from.entity,
                name: relation.from.name,
                required: false,
              },
            }
          : relation,
      ),
    };

    expect(() => compileApplicationPostgresSchema(unsupported)).toThrowError(
      ApplicationPostgresProjectionError,
    );
  });
});
