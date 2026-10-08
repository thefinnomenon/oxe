import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compileApplicationPostgresBootstrap,
  compileApplicationPostgresMigration,
  type ApplicationPostgresMigrationV1,
} from '@oxe/compiler';
import {
  createApplicationTelemetryCollector,
  loadApplicationGraph,
  mutateApplicationGraph,
  type ApplicationGraphV1,
} from '@oxe/graph';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ApplicationPostgresMigrationError,
  applyApplicationPostgresMigration,
  createNodePostgresPool,
  createPostgresApplicationHost,
  listPostgresApplicationContextOptions,
  resolvePostgresApplicationActiveContexts,
  type ApplicationSqlPoolV1,
} from '../src/index.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const graph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

const priorityGraph = (): ApplicationGraphV1 => {
  const result = mutateApplicationGraph(graph(), {
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
  });
  if (!result.ok) throw new Error(result.diagnostics[0]?.message);
  return result.graph;
};

const workflowGraph = (): ApplicationGraphV1 => {
  const base = graph();
  return loadApplicationGraph({
    ...base,
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
      ...base.operations,
      {
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
      {
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
      },
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
              as: 'notification',
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

const availablePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a PostgreSQL test port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const postgresBin = (): string | undefined => {
  try {
    const directory = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    return existsSync(join(directory, 'initdb')) && existsSync(join(directory, 'pg_ctl'))
      ? directory
      : undefined;
  } catch {
    return undefined;
  }
};

const binaryDirectory = postgresBin();

describe.skipIf(!binaryDirectory)('OXE PostgreSQL migration runtime', () => {
  let dataDirectory = '';
  let pool!: ApplicationSqlPoolV1;

  beforeAll(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'oxe-postgres-test-'));
    const port = await availablePort();
    execFileSync(
      join(binaryDirectory!, 'initdb'),
      ['-D', dataDirectory, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'],
      { stdio: 'ignore' },
    );
    execFileSync(
      join(binaryDirectory!, 'pg_ctl'),
      [
        '-D',
        dataDirectory,
        '-l',
        join(dataDirectory, 'postgres.log'),
        '-o',
        `-F -p ${port} -h 127.0.0.1`,
        '-w',
        'start',
      ],
      { stdio: 'ignore' },
    );
    pool = createNodePostgresPool({
      connectionString: `postgres://postgres@127.0.0.1:${port}/postgres`,
      max: 4,
    });
  }, 30_000);

  afterAll(async () => {
    await pool?.close();
    if (dataDirectory) {
      execFileSync(
        join(binaryDirectory!, 'pg_ctl'),
        ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'],
        { stdio: 'ignore' },
      );
      await rm(dataDirectory, { force: true, recursive: true });
    }
  }, 30_000);

  it('applies immutable bootstrap and priority migrations under an application lock', async () => {
    const bootstrap = compileApplicationPostgresBootstrap(graph());
    const first = await applyApplicationPostgresMigration(pool, bootstrap);
    expect(first).toMatchObject({ applied: true, fromRevision: 0, toRevision: 16 });
    await expect(applyApplicationPostgresMigration(pool, bootstrap)).resolves.toMatchObject({
      applied: false,
    });

    await pool.query(
      `INSERT INTO "oxe_todo"."team" ("id", "name", "owner_id") VALUES ($1, $2, $3), ($4, $5, $6)`,
      ['team-a', 'Alice team', 'user-alice', 'team-b', 'Bob team', 'user-bob'],
    );
    await pool.query(
      `INSERT INTO "oxe_todo"."team_membership" ("id", "user_id", "role", "status", "membership_member_id", "membership_team_id") VALUES ($1, $2, $3, $4, $5, $6)`,
      ['membership-charlie-a', 'user-charlie', 'member', 'active', 'user-charlie', 'team-a'],
    );
    await pool.query(
      `INSERT INTO "oxe_todo"."task" ("id", "title", "owner_id", "team_id") VALUES ($1, $2, $3, $4)`,
      ['task-before-priority', 'Existing task', 'user-alice', 'team-a'],
    );
    const priority = compileApplicationPostgresMigration(graph(), priorityGraph());
    const concurrent = await Promise.all([
      applyApplicationPostgresMigration(pool, priority),
      applyApplicationPostgresMigration(pool, priority),
    ]);
    expect(concurrent.map((result) => result.applied).sort()).toEqual([false, true]);
    const rows = await pool.query<{ readonly priority: string }>(
      `SELECT "priority" FROM "oxe_todo"."task" WHERE "id" = $1`,
      ['task-before-priority'],
    );
    expect(rows.rows).toEqual([{ priority: 'normal' }]);
    await expect(
      pool.query(
        `INSERT INTO "oxe_todo"."task" ("id", "title", "owner_id", "priority") VALUES ($1, $2, $3, $4)`,
        ['task-invalid-priority', 'Invalid task', 'user-alice', 'urgent'],
      ),
    ).rejects.toThrow();

    await expect(
      applyApplicationPostgresMigration(pool, { ...priority, sql: `${priority.sql}-- changed\n` }),
    ).rejects.toMatchObject({ code: 'OXE2502' });
    await expect(
      applyApplicationPostgresMigration(
        pool,
        { ...priority, sql: `${priority.sql}-- formatting-only compiler change\n` },
        { acceptedChecksums: [concurrent[0]!.checksum] },
      ),
    ).resolves.toMatchObject({ applied: false, checksum: concurrent[0]!.checksum });
  });

  it('rejects stale bases and rolls failed SQL back with no ledger advancement', async () => {
    const stale: ApplicationPostgresMigrationV1 = {
      appId: 'app.todo',
      fromRevision: 16,
      migrationId: 'stale-r16-r18',
      schemaVersion: 'oxe.application-postgres-migration.v1',
      sql: 'SELECT 1;\n',
      toRevision: 18,
    };
    await expect(applyApplicationPostgresMigration(pool, stale)).rejects.toMatchObject({
      code: 'OXE2503',
    });

    const broken: ApplicationPostgresMigrationV1 = {
      appId: 'app.todo',
      fromRevision: 17,
      migrationId: 'broken-r17-r18',
      schemaVersion: 'oxe.application-postgres-migration.v1',
      sql: `ALTER TABLE "oxe_todo"."task" ADD COLUMN "scratch" TEXT;
SELECT * FROM "missing_table";
`,
      toRevision: 18,
    };
    await expect(applyApplicationPostgresMigration(pool, broken)).rejects.not.toBeInstanceOf(
      ApplicationPostgresMigrationError,
    );
    const columns = await pool.query<{ readonly column_name: string }>(
      `SELECT column_name FROM information_schema.columns
WHERE table_schema = 'oxe_todo' AND table_name = 'task' AND column_name = 'scratch'`,
    );
    expect(columns.rows).toEqual([]);
    const head = await pool.query<{ readonly to_revision: number }>(
      `SELECT to_revision FROM public._oxe_migrations WHERE app_id = $1 ORDER BY to_revision DESC LIMIT 1`,
      ['app.todo'],
    );
    expect(head.rows).toEqual([{ to_revision: 17 }]);
  });

  it('executes generated Todo queries and operations with authoritative user isolation', async () => {
    const host = createPostgresApplicationHost(priorityGraph(), pool, {
      generateId: () => 'task-generated',
      now: () => '2026-08-28T10:00:00.000Z',
    });
    const alice = {
      activeContexts: [{ contextId: 'context.team', entityId: 'entity.team', recordId: 'team-a' }],
      userId: 'user-alice',
    } as const;
    const bob = {
      activeContexts: [{ contextId: 'context.team', entityId: 'entity.team', recordId: 'team-b' }],
      userId: 'user-bob',
    } as const;

    await expect(host.query('query.myTasks', alice)).resolves.toEqual([
      {
        createdAt: expect.any(String),
        done: false,
        id: 'task-before-priority',
        priority: 'normal',
        title: 'Existing task',
      },
    ]);
    await expect(
      host.execute('operation.createTask', { priority: 'high', title: 'Generated task' }, alice),
    ).resolves.toEqual({
      createdAt: '2026-08-28T10:00:00.000Z',
      done: false,
      id: 'task-generated',
      priority: 'high',
      title: 'Generated task',
    });
    await expect(host.query('query.myTasks', bob)).resolves.toEqual([]);

    const forged = {
      createdAt: '1900-01-01T00:00:00.000Z',
      done: true,
      id: 'task-before-priority',
      priority: 'low',
      title: 'Forged',
    };
    await expect(host.execute('operation.toggleTask', { task: forged }, bob)).rejects.toMatchObject(
      { code: 'OXE3403', kind: 'forbidden' },
    );
    await expect(
      host.execute('operation.toggleTask', { task: forged }, alice),
    ).resolves.toMatchObject({
      done: true,
      id: 'task-before-priority',
      priority: 'normal',
      title: 'Existing task',
    });
    await expect(
      host.execute('operation.renameTask', { task: forged, title: 'Bob cannot rename this' }, bob),
    ).rejects.toMatchObject({ code: 'OXE3403', kind: 'forbidden' });
    const renamed = await host.execute(
      'operation.renameTask',
      { task: forged, title: 'Renamed existing task' },
      alice,
    );
    expect(renamed).toMatchObject({
      done: true,
      id: 'task-before-priority',
      priority: 'normal',
      title: 'Renamed existing task',
    });
    await expect(
      host.execute('operation.deleteTask', { task: renamed }, bob),
    ).rejects.toMatchObject({ code: 'OXE3403', kind: 'forbidden' });
    await expect(
      host.execute('operation.deleteTask', { task: renamed }, alice),
    ).resolves.toMatchObject({ id: 'task-before-priority', title: 'Renamed existing task' });
    await expect(host.query('query.myTasks', alice)).resolves.toEqual([
      expect.objectContaining({ id: 'task-generated' }),
    ]);
    await expect(
      host.execute('operation.createTask', { priority: 'urgent', title: 'Invalid' }, alice),
    ).rejects.toMatchObject({ code: 'OXE3401', kind: 'validation' });
    await expect(
      host.query('query.myTasks', {
        activeContexts: [
          { contextId: 'context.team', entityId: 'entity.team', recordId: 'team-a' },
          { contextId: 'context.team', entityId: 'entity.team', recordId: 'team-b' },
        ],
        userId: 'user-alice',
      }),
    ).rejects.toMatchObject({ code: 'OXE3401', kind: 'validation' });
  });

  it('executes workflow locals in one PostgreSQL transaction and rolls failures back', async () => {
    await pool.query(
      `INSERT INTO "oxe_todo"."task" ("id", "title", "owner_id", "team_id") VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        'task-workflow',
        'Before workflow',
        'user-alice',
        'team-a',
        'task-workflow-rollback',
        'Keep after rollback',
        'user-alice',
        'team-a',
      ],
    );
    const capabilityCalls: unknown[] = [];
    const telemetry = createApplicationTelemetryCollector();
    let failDeadLetterDelivery = true;
    let jobId = 0;
    let jobNow = Date.parse('2026-08-30T12:00:00.000Z');
    const host = createPostgresApplicationHost(workflowGraph(), pool, {
      capabilityAdapters: {
        'capability.mail': {
          idempotency: 'jobId',
          invoke: (invocation) => {
            capabilityCalls.push(invocation);
            if (
              invocation.input.subject === 'Dead letter PostgreSQL title' &&
              failDeadLetterDelivery
            )
              throw new Error('provider unavailable');
            return Promise.resolve({ deliveryId: 'delivery-postgres-1' });
          },
        },
      },
      generateJobId: () => `job-postgres-mail-${(jobId += 1)}`,
      jobClock: () => jobNow,
      now: () => '2026-08-30T12:00:00.000Z',
      telemetry,
    });
    const context = {
      activeContexts: [{ contextId: 'context.team', entityId: 'entity.team', recordId: 'team-a' }],
      userId: 'user-alice',
    } as const;

    await expect(
      host.execute(
        'operation.renameAndToggleTask',
        {
          task: { done: true, id: 'task-workflow', title: 'Spoofed' },
          title: 'After workflow',
        },
        context,
      ),
    ).resolves.toMatchObject({ done: true, id: 'task-workflow', title: 'After workflow' });

    await expect(
      host.execute(
        'operation.rollbackWorkflow',
        { task: { id: 'task-workflow-rollback' } },
        context,
      ),
    ).rejects.toMatchObject({ code: 'OXE3404', kind: 'not-found' });
    const preserved = await pool.query<{ readonly title: string }>(
      `SELECT "title" FROM "oxe_todo"."task" WHERE "id" = $1`,
      ['task-workflow-rollback'],
    );
    expect(preserved.rows).toEqual([{ title: 'Keep after rollback' }]);
    await expect(
      host.execute('operation.sendMail', { subject: 'Welcome', to: 'person@example.com' }, context),
    ).resolves.toEqual({ deliveryId: 'delivery-postgres-1' });
    expect(capabilityCalls).toEqual([
      expect.objectContaining({
        capabilityId: 'capability.mail',
        method: 'send',
      }),
    ]);

    await expect(
      host.execute(
        'operation.renameAndNotifyTask',
        {
          task: { id: 'task-workflow' },
          title: 'Queued PostgreSQL title',
          to: 'person@example.com',
        },
        context,
      ),
    ).resolves.toMatchObject({ id: 'task-workflow', title: 'Queued PostgreSQL title' });
    expect(capabilityCalls).toHaveLength(1);
    await expect(host.runJobs({ workerId: 'test-worker' })).resolves.toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      pendingRetry: 0,
    });
    expect(capabilityCalls).toEqual([
      expect.objectContaining({ capabilityId: 'capability.mail', method: 'send' }),
      expect.objectContaining({
        capabilityId: 'capability.mail',
        delivery: { attempt: 1, jobId: 'job-postgres-mail-1' },
        input: { subject: 'Queued PostgreSQL title', to: 'person@example.com' },
        method: 'send',
      }),
    ]);
    const completedJob = await pool.query<{ readonly status: string }>(
      `SELECT "status" FROM "oxe_todo"."__oxe_outbox_jobs" WHERE "id" = $1`,
      ['job-postgres-mail-1'],
    );
    expect(completedJob.rows).toEqual([{ status: 'completed' }]);
    await expect(host.listJobs({ status: 'completed' })).resolves.toEqual([
      expect.objectContaining({
        attempts: 1,
        id: 'job-postgres-mail-1',
        status: 'completed',
      }),
    ]);

    await host.execute(
      'operation.renameAndNotifyTask',
      {
        task: { id: 'task-workflow' },
        title: 'Dead letter PostgreSQL title',
        to: 'private@example.com',
      },
      context,
    );
    await expect(host.runJobs({ workerId: 'test-worker' })).resolves.toMatchObject({
      pendingRetry: 1,
    });
    await expect(host.runJobs({ workerId: 'test-worker' })).resolves.toMatchObject({ claimed: 0 });
    jobNow += 1_000;
    await expect(host.runJobs({ workerId: 'test-worker' })).resolves.toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      pendingRetry: 0,
    });
    await expect(host.listJobs({ status: 'deadLetter' })).resolves.toEqual([
      expect.objectContaining({
        attempts: 2,
        id: 'job-postgres-mail-2',
        lastErrorKind: 'delivery',
        status: 'deadLetter',
      }),
    ]);
    expect(JSON.stringify(await host.listJobs())).not.toContain('private@example.com');
    failDeadLetterDelivery = false;
    await expect(host.replayJob('job-postgres-mail-2', { maxAttempts: 3 })).resolves.toMatchObject({
      attempts: 0,
      maxAttempts: 3,
      status: 'pending',
    });
    await expect(host.runJobs({ workerId: 'test-worker' })).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
    });
    expect(telemetry.snapshot().spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'operation',
          outcome: 'success',
          semanticId: 'operation.renameAndNotifyTask',
        }),
        expect.objectContaining({ kind: 'job', outcome: 'success', semanticId: 'outbox.run' }),
      ]),
    );
    expect(JSON.stringify(telemetry.snapshot())).not.toContain('person@example.com');
  });

  it('enforces external users, pending invitation acceptance, revocation, and uniqueness', async () => {
    let generatedMemberships = 0;
    const host = createPostgresApplicationHost(priorityGraph(), pool, {
      externalReferenceExists: ({ entityId, recordId }) =>
        Promise.resolve(entityId === 'builtin.user' && recordId === 'user-bob'),
      generateId: () => `membership-generated-${(generatedMemberships += 1)}`,
      now: () => '2026-08-28T11:00:00.000Z',
    });
    const owner = {
      activeContexts: [
        { contextId: 'context.ownedTeam', entityId: 'entity.team', recordId: 'team-a' },
      ],
      userId: 'user-alice',
    } as const;
    const bob = { activeContexts: [], userId: 'user-bob' } as const;
    const bobTeam = {
      activeContexts: [{ contextId: 'context.team', entityId: 'entity.team', recordId: 'team-a' }],
      userId: 'user-bob',
    } as const;

    await expect(
      host.execute('operation.inviteTeamMember', { userId: 'user-missing' }, owner),
    ).rejects.toMatchObject({ code: 'OXE3404', kind: 'not-found' });

    const invitation = await host.execute(
      'operation.inviteTeamMember',
      { userId: 'user-bob' },
      owner,
    );
    expect(invitation).toMatchObject({ accepted: false, role: 'member', userId: 'user-bob' });
    await expect(
      resolvePostgresApplicationActiveContexts(priorityGraph(), pool, 'user-bob', [
        { contextId: 'context.team', recordId: 'team-a' },
      ]),
    ).rejects.toMatchObject({ code: 'OXE3403', kind: 'forbidden' });
    await expect(
      host.execute('operation.inviteTeamMember', { userId: 'user-bob' }, owner),
    ).rejects.toMatchObject({ code: 'OXE3401', kind: 'validation' });
    await expect(host.query('query.myTeamInvitations', bob)).resolves.toEqual([
      expect.objectContaining({ accepted: false, id: expect.any(String), userId: 'user-bob' }),
    ]);

    const accepted = await host.execute('operation.acceptTeamInvitation', { invitation }, bob);
    expect(accepted).toMatchObject({ accepted: true, userId: 'user-bob' });
    await expect(host.query('query.myTeamInvitations', bob)).resolves.toEqual([]);
    await expect(
      resolvePostgresApplicationActiveContexts(priorityGraph(), pool, 'user-bob', [
        { contextId: 'context.team', recordId: 'team-a' },
      ]),
    ).resolves.toEqual(bobTeam.activeContexts);
    await expect(host.query('query.teamInvitations', owner)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ accepted: true, userId: 'user-bob' })]),
    );

    await expect(
      host.execute('operation.revokeTeamInvitation', { invitation: accepted }, owner),
    ).resolves.toMatchObject({ id: expect.any(String), userId: 'user-bob' });
    await expect(
      resolvePostgresApplicationActiveContexts(priorityGraph(), pool, 'user-bob', [
        { contextId: 'context.team', recordId: 'team-a' },
      ]),
    ).rejects.toMatchObject({ code: 'OXE3403', kind: 'forbidden' });
  });

  it('resolves role-based contexts and keeps roles distinct from their entity type', async () => {
    const base = priorityGraph();
    const teamRole = base.contexts?.find((context) => context.id === 'context.team');
    const ownedTeamRole = base.contexts?.find((context) => context.id === 'context.ownedTeam');
    if (!teamRole || !ownedTeamRole) throw new Error('Missing Team context roles.');
    const roleGraph = loadApplicationGraph({
      ...base,
      app: {
        ...base.app,
        contexts: ['context.team', 'context.ownedTeam', 'context.workspace'],
      },
      contexts: [
        teamRole,
        ownedTeamRole,
        { ...teamRole, id: 'context.workspace', name: 'Workspace' },
      ],
    });
    await expect(
      resolvePostgresApplicationActiveContexts(roleGraph, pool, 'user-alice', [
        { contextId: 'context.team', recordId: 'team-a' },
        { contextId: 'context.workspace', recordId: 'team-a' },
      ]),
    ).resolves.toEqual([
      { contextId: 'context.team', entityId: 'entity.team', recordId: 'team-a' },
      { contextId: 'context.workspace', entityId: 'entity.team', recordId: 'team-a' },
    ]);
    await expect(
      resolvePostgresApplicationActiveContexts(base, pool, 'user-bob', [
        { contextId: 'context.team', recordId: 'team-a' },
      ]),
    ).rejects.toMatchObject({ code: 'OXE3403', kind: 'forbidden' });
    await expect(
      resolvePostgresApplicationActiveContexts(base, pool, 'user-charlie', [
        { contextId: 'context.team', recordId: 'team-a' },
      ]),
    ).resolves.toEqual([
      { contextId: 'context.team', entityId: 'entity.team', recordId: 'team-a' },
    ]);
    await expect(
      listPostgresApplicationContextOptions(base, pool, 'user-charlie', 'context.team'),
    ).resolves.toEqual([
      {
        contextId: 'context.team',
        entityId: 'entity.team',
        label: 'Alice team',
        recordId: 'team-a',
      },
    ]);
  });
});
