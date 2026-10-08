import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ApplicationArtifactCache,
  ApplicationPublicationManager,
  compileApplicationPostgresBootstrap,
} from '@oxe/compiler';
import { loadApplicationGraph, mutateApplicationGraph, type ApplicationGraphV1 } from '@oxe/graph';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { WorkspaceApplicationTarget } from '../src/application-target.js';
import { createHotApplicationPublication } from '../src/hot-publication.js';

const fixtureDirectory = new URL('../../../examples/application-graph-todo/', import.meta.url);
const fixtureUrl = new URL('graph.json', fixtureDirectory);
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

const availablePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a PostgreSQL test port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });

const binaryDirectory = postgresBin();

describe.skipIf(!binaryDirectory)('workspace hot application publication', () => {
  let connectionString = '';
  let dataDirectory = '';
  let stateDirectory = '';

  beforeAll(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'oxe-hot-publication-postgres-'));
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
    connectionString = `postgres://postgres@127.0.0.1:${port}/postgres`;
    const stateParent = new URL('.oxe/', fixtureDirectory);
    mkdirSync(stateParent, { recursive: true });
    stateDirectory = await mkdtemp(join(stateParent.pathname, 'hot-publication-test-'));
  }, 30_000);

  afterAll(async () => {
    if (dataDirectory)
      execFileSync(
        join(binaryDirectory!, 'pg_ctl'),
        ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'],
        { stdio: 'ignore' },
      );
    if (stateDirectory) await rm(stateDirectory, { force: true, recursive: true });
    if (dataDirectory) await rm(dataDirectory, { force: true, recursive: true });
  }, 30_000);

  it('builds, migrates, starts, activates, and recovers a generated candidate', async () => {
    const base = graph();
    const next = priorityGraph();
    const sourcePool = new Pool({ connectionString, max: 1 });
    await sourcePool.query(compileApplicationPostgresBootstrap(base).sql);
    await sourcePool.query(
      `INSERT INTO "oxe_todo"."team" ("id", "name", "created_at", "owner_id")
       VALUES ($1, $2, CURRENT_TIMESTAMP, $3)`,
      ['team.persisted', 'Persisted team', 'user.persisted'],
    );
    await sourcePool.end();
    const target = new WorkspaceApplicationTarget({
      databaseURL: connectionString,
      id: 'configured',
      revision: base.revision,
      url: 'http://127.0.0.1:39999',
    });
    const options = {
      allowedOrigins: ['http://127.0.0.1:4175'],
      applicationTarget: target,
      authSecret: 'hot-publication-test-secret-with-32-characters',
      databaseURL: connectionString,
      expectedActiveRevision: base.revision,
      projectDirectory: fixtureDirectory.pathname,
      stateDirectory,
    } as const;
    const controller = await createHotApplicationPublication(options, base);
    expect(controller.recoveredRuntime).toBeUndefined();
    const cache = new ApplicationArtifactCache();
    const manager = new ApplicationPublicationManager(cache.compile(base), {
      adapter: controller.adapter,
      compile: (candidate) => cache.compile(candidate),
    });

    await manager.publish(next);
    expect(target.current()).toMatchObject({ revision: 17 });
    await expect(
      fetch(`${target.current().url}/health`).then((response) => response.json()),
    ).resolves.toMatchObject({ appId: 'app.todo', revision: 17, status: 'ok' });
    const activeDatabaseName = target.current().databaseName;
    expect(activeDatabaseName).toMatch(/^oxe_hot_app_todo_r17_/u);
    const candidatePool = new Pool({ connectionString: target.current().databaseURL, max: 1 });
    await expect(
      candidatePool.query(`SELECT "name" FROM "oxe_todo"."team" WHERE "id" = $1`, [
        'team.persisted',
      ]),
    ).resolves.toMatchObject({ rows: [{ name: 'Persisted team' }] });
    await candidatePool.end();
    await manager.close();

    const recoveredTarget = new WorkspaceApplicationTarget({
      databaseURL: connectionString,
      id: 'configured',
      revision: base.revision,
      url: 'http://127.0.0.1:39999',
    });
    const recovered = await createHotApplicationPublication(
      { ...options, applicationTarget: recoveredTarget, expectedActiveRevision: 17 },
      next,
    );
    expect(recovered.recoveredRuntime).toBeDefined();
    expect(recoveredTarget.current()).toMatchObject({
      databaseName: activeDatabaseName,
      revision: 17,
    });
    await expect(
      fetch(`${recoveredTarget.current().url}/health`).then((response) => response.json()),
    ).resolves.toMatchObject({ revision: 17, status: 'ok' });
    await recovered.recoveredRuntime?.dispose();
    expect(recoveredTarget.current()).toMatchObject({ id: 'configured', revision: 16 });
  }, 60_000);
});
