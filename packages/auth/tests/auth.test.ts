import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileApplicationPostgresBootstrap, lowerApplicationRouteToUiGraph } from '@oxe/compiler';
import { loadApplicationGraph, type ApplicationGraphV1 } from '@oxe/graph';
import {
  applyApplicationPostgresMigration,
  createNodePostgresPool,
  resolvePostgresApplicationActiveContexts,
  type ApplicationSqlPoolV1,
} from '@oxe/postgres';
import {
  createFetchServerFunctionTransport,
  createServerFunctionCapabilityMap,
  createServerFunctionFetchHandler,
} from '@oxe/server-functions';
import { createPostgresApplicationServerFunctions } from '@oxe/server-functions/application-postgres';
import { readApplicationActiveContextRequest } from '@oxe/server-functions/auth';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createOxeBetterAuth,
  migrateOxeBetterAuth,
  readBetterAuthApplicationContext,
  type OxeBetterAuthV1,
} from '../src/index.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const graph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

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

const responseCookies = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .filter((cookie): cookie is string => cookie !== undefined)
    .join('; ');

describe.skipIf(!binaryDirectory)('Better Auth Todo integration', () => {
  let adminPool!: Pool;
  let applicationPool!: ApplicationSqlPoolV1;
  let authPool!: Pool;
  let auth!: OxeBetterAuthV1;
  let baseURL = '';
  let dataDirectory = '';

  beforeAll(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'oxe-auth-test-'));
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
    const connectionString = `postgres://postgres@127.0.0.1:${port}/postgres`;
    baseURL = `http://127.0.0.1:${port}`;
    adminPool = new Pool({ connectionString });
    await adminPool.query('CREATE SCHEMA auth');
    authPool = new Pool({ connectionString, options: '-c search_path=auth' });
    applicationPool = createNodePostgresPool({ connectionString, max: 4 });
    auth = createOxeBetterAuth({
      appName: 'TinyTodo',
      baseURL,
      database: authPool,
      secret: 'test-only-secret-with-at-least-32-characters',
      trustedOrigins: [baseURL],
    });
  }, 30_000);

  afterAll(async () => {
    await applicationPool?.close();
    await authPool?.end();
    await adminPool?.end();
    if (dataDirectory) {
      execFileSync(
        join(binaryDirectory!, 'pg_ctl'),
        ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'],
        { stdio: 'ignore' },
      );
      await rm(dataDirectory, { force: true, recursive: true });
    }
  }, 30_000);

  const signUp = async (name: string, email: string): Promise<string> => {
    const response = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-up/email`, {
        body: JSON.stringify({ email, name, password: 'correct-horse-battery-staple' }),
        headers: { 'content-type': 'application/json', origin: baseURL },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);
    const cookies = responseCookies(response);
    expect(cookies).toContain('better-auth.session_token=');
    return cookies;
  };

  const signIn = async (email: string): Promise<string> => {
    const response = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-in/email`, {
        body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
        headers: { 'content-type': 'application/json', origin: baseURL },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);
    const cookies = responseCookies(response);
    expect(cookies).toContain('better-auth.session_token=');
    return cookies;
  };

  const signOut = async (cookie: string): Promise<void> => {
    const response = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-out`, {
        headers: { cookie, origin: baseURL },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);
  };

  it('creates accounts and enforces cookie-session Todo ownership end to end', async () => {
    await expect(migrateOxeBetterAuth(auth)).resolves.toEqual({ added: 0, created: 4 });
    await expect(migrateOxeBetterAuth(auth)).resolves.toEqual({ added: 0, created: 0 });
    await applyApplicationPostgresMigration(
      applicationPool,
      compileApplicationPostgresBootstrap(graph()),
    );

    const initialAliceCookie = await signUp('Alice', 'alice@example.test');
    const bobCookie = await signUp('Bob', 'bob@example.test');
    const initialAliceContext = await readBetterAuthApplicationContext(
      auth,
      new Headers({ cookie: initialAliceCookie }),
    );
    await signOut(initialAliceCookie);
    await expect(
      readBetterAuthApplicationContext(auth, new Headers({ cookie: initialAliceCookie })),
    ).resolves.toEqual({});
    const aliceCookie = await signIn('alice@example.test');
    const aliceContext = await readBetterAuthApplicationContext(
      auth,
      new Headers({ cookie: aliceCookie }),
    );
    const bobContext = await readBetterAuthApplicationContext(
      auth,
      new Headers({ cookie: bobCookie }),
    );
    expect(aliceContext.userId).toEqual(expect.any(String));
    expect(aliceContext.userId).toBe(initialAliceContext.userId);
    expect(bobContext.userId).toEqual(expect.any(String));
    expect(aliceContext.userId).not.toBe(bobContext.userId);
    await expect(readBetterAuthApplicationContext(auth, new Headers())).resolves.toEqual({});

    const todoGraph = graph();
    const definitions = lowerApplicationRouteToUiGraph(todoGraph).graph.serverFunctions ?? [];
    const application = createPostgresApplicationServerFunctions(
      todoGraph,
      definitions,
      applicationPool,
      {
        generateId: (() => {
          let sequence = 0;
          return () => `task-${++sequence}`;
        })(),
        now: () => '2026-08-28T10:00:00.000Z',
      },
    );
    const rpcHandler = createServerFunctionFetchHandler(application.registry, {
      allowedOrigins: [baseURL],
      createContext: (request) =>
        readBetterAuthApplicationContext(
          auth,
          request.headers,
          readApplicationActiveContextRequest(request.headers, todoGraph.app.contexts ?? []),
          (userId, requested) =>
            resolvePostgresApplicationActiveContexts(todoGraph, applicationPool, userId, requested),
        ),
    });
    const capabilities = (
      cookie: string,
      contexts: readonly { readonly contextId: string; readonly recordId: string }[] = [],
    ) =>
      createServerFunctionCapabilityMap(
        definitions,
        createFetchServerFunctionTransport({
          endpoint: `${baseURL}/api/functions`,
          fetch: (input, init) => rpcHandler(new Request(input, init)),
          headers: {
            cookie,
            origin: baseURL,
            ...(contexts.length > 0 ? { 'x-oxe-active-contexts': JSON.stringify(contexts) } : {}),
          },
        }),
      );
    const capability = (values: ReturnType<typeof capabilities>, id: string) => {
      const definition = definitions.find((candidate) => candidate.id === id);
      if (!definition) throw new Error(`Missing definition ${id}.`);
      const value = values.get(definition.path.join('.'));
      if (!value) throw new Error(`Missing capability ${id}.`);
      return value;
    };
    const signal = new AbortController().signal;
    const aliceAccount = capabilities(aliceCookie);
    const bobAccount = capabilities(bobCookie);
    const aliceTeam = (await capability(aliceAccount, 'app.todo/operation.createTeam')(
      'Alice team',
      signal,
    )) as { readonly id: string };
    const bobTeam = (await capability(bobAccount, 'app.todo/operation.createTeam')(
      'Bob team',
      signal,
    )) as { readonly id: string };
    const alice = capabilities(aliceCookie, [
      { contextId: 'context.team', recordId: aliceTeam.id },
    ]);
    const bob = capabilities(bobCookie, [{ contextId: 'context.team', recordId: bobTeam.id }]);

    const aliceTask = await capability(alice, 'app.todo/operation.createTask')(
      'Alice private task',
      signal,
    );
    await capability(bob, 'app.todo/operation.createTask')('Bob private task', signal);
    await expect(capability(alice, 'app.todo/query.myTasks')(signal)).resolves.toEqual([
      expect.objectContaining({ id: 'task-3', title: 'Alice private task' }),
    ]);
    await expect(capability(bob, 'app.todo/query.myTasks')(signal)).resolves.toEqual([
      expect.objectContaining({ id: 'task-4', title: 'Bob private task' }),
    ]);
    await expect(
      capability(bob, 'app.todo/operation.toggleTask')(aliceTask, signal),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(
      capability(bob, 'app.todo/operation.renameTask')(aliceTask, 'Bob cannot rename this', signal),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    const renamed = await capability(alice, 'app.todo/operation.renameTask')(
      aliceTask,
      'Alice renamed task',
      signal,
    );
    await expect(
      capability(bob, 'app.todo/operation.deleteTask')(renamed, signal),
    ).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(
      capability(alice, 'app.todo/operation.deleteTask')(renamed, signal),
    ).resolves.toMatchObject({
      id: 'task-3',
      title: 'Alice renamed task',
    });
  });
});
