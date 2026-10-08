import { readFileSync } from 'node:fs';

import { compileApplicationPostgresMigration } from '@oxe/compiler';
import { loadApplicationGraph } from '@oxe/graph';
import type { ApplicationSqlConnectionV1, ApplicationSqlPoolV1 } from '@oxe/postgres';
import { describe, expect, it } from 'vitest';

import {
  backfillTodoRevision13Teams,
  todoRevision12Graph,
  todoRevision13Graph,
  todoRevision14Graph,
  todoRevision15Graph,
} from '../src/migrations.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);

describe('TinyTodo application migration', () => {
  it('creates the Team table before adding the Task foreign key', () => {
    const current = loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);
    const revision13 = todoRevision13Graph(current);
    const migration = compileApplicationPostgresMigration(todoRevision12Graph(current), revision13);
    const createTeam = migration.sql.indexOf('CREATE TABLE "oxe_todo"."team"');
    const addTaskTeam = migration.sql.indexOf('ADD CONSTRAINT "fk_task_team"');

    expect(migration).toMatchObject({ fromRevision: 12, toRevision: 13 });
    expect(createTeam).toBeGreaterThanOrEqual(0);
    expect(addTaskTeam).toBeGreaterThan(createTeam);
    expect(migration.sql.match(/ADD COLUMN "owner_id"/gu)).toBeNull();
  });

  it('adds membership storage in the isolated r13 to r14 migration', () => {
    const current = loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);
    const revision14 = todoRevision14Graph(current);
    const migration = compileApplicationPostgresMigration(todoRevision13Graph(current), revision14);

    expect(migration).toMatchObject({ fromRevision: 13, toRevision: 14 });
    expect(migration.sql).toContain('CREATE TABLE "oxe_todo"."team_membership"');
    expect(migration.sql).toContain('ADD CONSTRAINT "fk_membership_team"');
  });

  it('adds pending acceptance and membership uniqueness in the isolated r14 to r15 migration', () => {
    const current = loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);
    const revision15 = todoRevision15Graph(current);
    const migration = compileApplicationPostgresMigration(todoRevision14Graph(current), revision15);

    expect(migration).toMatchObject({ fromRevision: 14, toRevision: 15 });
    expect(migration.sql).toContain('ADD COLUMN "accepted" BOOLEAN NOT NULL DEFAULT TRUE');
    expect(migration.sql).toContain(
      'ADD CONSTRAINT "uq_membership_team_member" UNIQUE ("membership_member_id", "membership_team_id")',
    );
  });

  it('advances r15 cache and view semantics without changing PostgreSQL storage', () => {
    const current = loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);
    const migration = compileApplicationPostgresMigration(todoRevision15Graph(current), current);

    expect(migration).toMatchObject({ fromRevision: 15, toRevision: 16 });
    expect(migration.sql).toBe('-- No database changes.\n');
  });

  it('backfills deterministic Personal teams for pre-Team tasks in one transaction', async () => {
    const statements: string[] = [];
    const query: ApplicationSqlConnectionV1['query'] = async (statement) => {
      statements.push(statement);
      return { rowCount: 0, rows: [] };
    };
    const pool: ApplicationSqlPoolV1 = {
      close: async () => undefined,
      query,
      transaction: async <Value>(
        run: (connection: ApplicationSqlConnectionV1) => Promise<Value>,
      ): Promise<Value> => run({ query }),
    };

    await backfillTodoRevision13Teams(pool);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('\'team-personal-\' || md5("owner_id")');
    expect(statements[0]).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(statements[1]).toContain('WHERE "team_id" IS NULL');
  });
});
